#!/usr/bin/env python3
"""Pull playable notes out of a SoundFont (.sf2) and write them out as WAVs.

Why this exists
---------------
Clicker wants a real instrument, not a triangle wave. A SoundFont is the
cheapest source of one: it already holds a recording of every key, with the
velocity layers, the loop points and the level information a player needs. But
a .sf2 is a container the browser cannot play, and the banks worth having are
10-50 MB. So this tool takes the bank apart offline, keeps only the keys the
game can actually reach, and writes a handful of small WAVs plus the manifest
the browser side needs.

It is a build-time tool. The soundfonts stay on the developer's disk and never
enter the repository; what lands in the repository is the extracted audio.

Everything here is standard library only: this machine has no fluidsynth, no
ffmpeg, no numpy, and a game that needs a Python package to build its own
samples is a game that will not build anywhere else.

How a SoundFont is put together (the parts that matter)
-------------------------------------------------------
    RIFF / sfbk
      LIST sdta -> smpl            the raw 16-bit PCM, all samples together
      LIST pdta -> phdr pbag pgen   the presets and their zones
                   inst ibag igen  the instruments and their zones
                   shdr              where each sample lives in smpl

A *zone* is a slice of generators: "this sample, for these keys, at these
velocities, this loud". Zones are chained through bags, and each preset and
each instrument owns a contiguous run of them - so the first thing to get
right is that a preset only owns the zones between its own bag index and the
next preset's. Ignore that and you will happily play a note from the wrong
preset.

Two encodings catch everyone out:

  * A range generator (keyRange, velRange) puts the MINIMUM in the high bits
    and the MAXIMUM in the low bits. It reads backwards.
  * A sample's root key is what it was recorded at. To play key K from a
    sample recorded at root R, the playback rate is 2^((K - R) / 12).

Usage
-----
    python3 games/clicker/tools/extract_sf2.py \
        --sf2 "/path/to/Full Grand Piano.sf2" \
        --preset "Warm Grand" --voice piano \
        --keys 55-87 --velocity 100 \
        --out games/clicker/samples

Writes <out>/<voice>/*.wav, <out>/<voice>.js (the manifest, with the URLs
Vite needs) and refreshes <out>/bank.js.
"""

import argparse
import array
import json
import math
import os
import struct
import sys
import wave

# Generator numbers we care about (SF2 spec 8.1.2).
GEN_INSTRUMENT = 41      # index of the instrument for a preset zone
GEN_PAN = 42
GEN_KEY_RANGE = 43
GEN_VEL_RANGE = 44
GEN_COARSE_TUNE = 51     # cents
GEN_FINE_TUNE = 52       # cents
GEN_SAMPLE_ID = 53
GEN_SAMPLE_MODES = 54    # 0 = no loop, 1 = loop, 2 = one-shot
GEN_ROOT_KEY = 55
GEN_SCALE_TUNING = 56    # cents per semitone
GEN_OVERRIDING_ROOT_KEY = 58

SAMPLE_MODES_NO_LOOP = 0
SAMPLE_MODES_LOOP = 1

# A 1-sample stereo/little helper so the module reads like the spec.
CHANNELS = 1
SAMPLE_WIDTH = 2


# --------------------------------------------------------------- container --

def _chunks(data, start, end):
    """Walk RIFF chunks between two offsets."""
    p = start
    while p + 8 <= end:
        cid = data[p:p + 4]
        size = struct.unpack_from('<I', data, p + 4)[0]
        yield cid, p + 8, size
        p += 8 + size + (size & 1)


def _range_of(amount):
    """SF2 range generator -> (low, high).

    The spec puts the MINIMUM in the high bits and the MAXIMUM in the low
    bits. Half the banks in the wild do it the other way round - the Wurlitzer
    here writes (21, 88) as 88<<7 | 21, so reading it the spec's way gives
    (88, 21), a range nobody meant. So: read it the spec's way, and if that
    comes out backwards, read it the other way. A range that is valid either
    way is only equal anyway.
    """
    high = (amount >> 7) & 0x7F
    low = amount & 0x7F
    if high > low:
        return (low, high)
    return (high, low)


class SoundFont(object):
    """A parsed .sf2: presets, instruments, zones and sample data."""

    def __init__(self, path):
        self.path = path
        with open(path, 'rb') as fh:
            self.data = fh.read()
        d = self.data
        if d[:4] != b'RIFF' or d[8:12] != b'sfbk':
            raise ValueError('not a SoundFont (no RIFF/sfbk header): ' + path)

        lists = {}
        for cid, off, size in _chunks(d, 12, len(d)):
            if cid == b'LIST':
                lists[d[off:off + 4].decode('latin1')] = (off + 4, off + 4 + size - 4)
        if 'pdta' not in lists or 'sdta' not in lists:
            raise ValueError('no preset or sample data in ' + path)

        o, e = lists['pdta']
        pdta = dict((c.decode('latin1'), (off, size)) for c, off, size in _chunks(d, o, e))
        o, e = lists['sdta']
        sdta = [(off, size) for c, off, size in _chunks(d, o, e) if c == b'smpl']
        if not sdta:
            raise ValueError('no smpl chunk in ' + path)
        self.smpl_off, self.smpl_size = sdta[0]

        self.presets = self._read_presets(pdta)
        self.instruments = self._read_instruments(pdta)
        self._preset_zones = self._read_zones(pdta, 'pbag', 'pgen')
        self._inst_zones = self._read_zones(pdta, 'ibag', 'igen')
        self._shdr = self._read_sample_headers(pdta)

    # -- chunk readers ----------------------------------------------------

    def _read_presets(self, pdta):
        off, size = pdta['phdr']
        out = []
        for i in range(size // 38):
            rec = self.data[off + i * 38: off + (i + 1) * 38]
            out.append({
                'name': rec[:20].split(b'\0')[0].decode('latin1'),
                'preset': struct.unpack_from('<H', rec, 20)[0],
                'bank': struct.unpack_from('<H', rec, 22)[0],
                'bag': struct.unpack_from('<H', rec, 24)[0],
            })
        return out

    def _read_instruments(self, pdta):
        off, size = pdta['inst']
        out = []
        for i in range(size // 22):
            rec = self.data[off + i * 22: off + (i + 1) * 22]
            out.append({
                'name': rec[:20].split(b'\0')[0].decode('latin1'),
                'bag': struct.unpack_from('<H', rec, 20)[0],
            })
        return out

    def _read_zones(self, pdta, bag_chunk, gen_chunk):
        """Every zone in the bank, as a dict of generator -> amount."""
        boff, bsize = pdta[bag_chunk]
        goff, gsize = pdta[gen_chunk]
        bags = [struct.unpack_from('<HH', self.data, boff + i * 4) for i in range(bsize // 4)]
        gens = [struct.unpack_from('<Hh', self.data, goff + i * 4) for i in range(gsize // 4)]
        zones = []
        for i in range(len(bags) - 1):
            zone = {}
            for oper, amt in gens[bags[i][0]:bags[i + 1][0]]:
                zone.setdefault(oper, amt)
            zones.append(zone)
        return zones

    def _read_sample_headers(self, pdta):
        off, size = pdta['shdr']
        out = []
        for i in range(size // 46):
            rec = self.data[off + i * 46: off + (i + 1) * 46]
            name = rec[:20].split(b'\0')[0].decode('latin1')
            start, end, loop_start, loop_end = struct.unpack_from('<IIII', rec, 20)
            rate = struct.unpack_from('<I', rec, 36)[0]
            stype = struct.unpack_from('<H', rec, 44)[0]
            out.append({
                'name': name, 'start': start, 'end': end,
                'loop_start': loop_start, 'loop_end': loop_end,
                'rate': rate, 'type': stype,
            })
        return out

    # -- lookup ------------------------------------------------------------

    def preset(self, name):
        for p in self.presets:
            if p['name'] == name:
                return p
        names = ', '.join(repr(p['name']) for p in self.presets[:20])
        raise ValueError('no preset named %r. This bank has: %s' % (name, names))

    def _zones_of(self, presets_or_insts, zones, index):
        """The zones one preset (or instrument) owns, plus its global zone."""
        bag = presets_or_insts[index]['bag']
        if index + 1 < len(presets_or_insts):
            end = presets_or_insts[index + 1]['bag']
        else:
            end = len(zones)
        owned = zones[bag:end]
        if not owned:
            return {}, []
        return owned[0], owned[1:]

    def zones_for(self, preset_name, key, velocity):
        """Every zone of a preset that can play `key` at `velocity`.

        Each entry is a dict:
          merged  the generators that decide the note: preset global, preset
                  zone, instrument global, instrument zone, in that order of
                  precedence;
          inst    the instrument zone's own generators (the level and the loop
                  mode live there, and they mean something different in an
                  instrument zone than in a preset zone);
          index   which instrument this zone points at.
        """
        pindex = self.presets.index(self.preset(preset_name))
        pglobal, pzones = self._zones_of(self.presets, self._preset_zones, pindex)
        out = []
        for pz in pzones:
            if GEN_INSTRUMENT not in pz:
                continue
            iindex = pz[GEN_INSTRUMENT]
            if iindex >= len(self.instruments):
                continue
            iglobal, izones = self._zones_of(self.instruments, self._inst_zones, iindex)
            for iz in izones:
                merged = dict(pglobal)
                merged.update(pz)
                merged.update(iglobal)
                merged.update(iz)
                krange = merged.get(GEN_KEY_RANGE)
                if krange is None:
                    continue
                klo, khi = _range_of(krange)
                if not (klo <= key <= khi):
                    continue
                vrange = merged.get(GEN_VEL_RANGE)
                if vrange is not None:
                    vlo, vhi = _range_of(vrange)
                    if not (vlo <= velocity <= vhi):
                        continue
                if GEN_SAMPLE_ID not in merged:
                    continue
                out.append({'merged': merged, 'inst': iz, 'index': iindex})
        return out

    def voice_zones(self, preset_name, velocity):
        """Every zone of a preset that belongs to the velocity layer asked for.

        The key range is deliberately NOT applied here. A zone's key range is
        the bank telling you which keys it will play, and in the Wurlitzer it
        is plainly wrong: the sample recorded at key 82 says it plays 36-79.
        The recording does not lie - the note it holds is the note it holds -
        so the key a sample can play is decided by the pitch it was recorded
        at, and the bank's range is only a hint about which layer to take.
        """
        pindex = self.presets.index(self.preset(preset_name))
        pglobal, pzones = self._zones_of(self.presets, self._preset_zones, pindex)
        out = []
        for pz in pzones:
            if GEN_INSTRUMENT not in pz:
                continue
            iindex = pz[GEN_INSTRUMENT]
            if iindex >= len(self.instruments):
                continue
            iglobal, izones = self._zones_of(self.instruments, self._inst_zones, iindex)
            for iz in izones:
                merged = dict(pglobal)
                merged.update(pz)
                merged.update(iglobal)
                merged.update(iz)
                vrange = merged.get(GEN_VEL_RANGE)
                if vrange is not None:
                    vlo, vhi = _range_of(vrange)
                    if not (vlo <= velocity <= vhi):
                        continue
                if GEN_SAMPLE_ID not in merged:
                    continue
                out.append({'merged': merged, 'inst': iz, 'index': iindex})
        return out

    # -- sample data -------------------------------------------------------

    def sample_pcm(self, sample_id):
        """The raw 16-bit frames of a sample, as a list of ints."""
        sh = self._shdr[sample_id]
        if sh['rate'] < 4000 or sh['rate'] > 200000:
            raise ValueError('sample %r has a nonsense rate %d' % (sh['name'], sh['rate']))
        a = array.array('h')
        a.frombytes(self.data[self.smpl_off + sh['start'] * 2: self.smpl_off + sh['end'] * 2])
        if sys.byteorder == 'big':
            a.byteswap()
        return a, sh

    def root_key_of(self, gens):
        """The key the bank says the sample was recorded at, or None.

        None means the bank does not say: the Wurlitzer has no root key
        generator at all, and the Rhodes leaves one out for some samples.
        """
        if GEN_OVERRIDING_ROOT_KEY in gens:
            return gens[GEN_OVERRIDING_ROOT_KEY]
        if GEN_ROOT_KEY in gens:
            return gens[GEN_ROOT_KEY]
        return None

    def cents_of(self, gens):
        """Tuning of the zone, in cents."""
        cents = gens.get(GEN_COARSE_TUNE, 0) + gens.get(GEN_FINE_TUNE, 0)
        scale = gens.get(GEN_SCALE_TUNING, 100)
        return cents * (scale / 100.0) if scale != 100 else cents

    def loops(self, gens, sh):
        """The loop region of a sample, in frames relative to its start."""
        if gens.get(GEN_SAMPLE_MODES, SAMPLE_MODES_NO_LOOP) != SAMPLE_MODES_LOOP:
            return None
        start = sh['loop_start'] - sh['start']
        end = sh['loop_end'] - sh['start']
        length = sh['end'] - sh['start']
        if not (0 <= start < end <= length):
            return None
        return (start, end)


# ------------------------------------------------------------------- audio --

def peak_of(samples):
    if not samples:
        return 0
    return max(abs(s) for s in samples)


def trim_tail(samples, rate, thresh_db, max_seconds, min_seconds):
    """Cut the quiet tail off a note, and report where the note really ends.

    A piano sample in these banks runs 4-6 seconds because the recording kept
    the room going. The game plays short notes; shipping the reverb tail would
    cost megabytes for silence.
    """
    if not samples:
        return samples, 0
    peak = peak_of(samples) or 1
    thr = peak * (10 ** (thresh_db / 20.0))
    win = max(1, rate // 200)          # 5 ms windows
    last = 0
    for i in range(0, len(samples), win):
        if peak_of(samples[i:i + win]) > thr:
            last = i + win
    hard = int(rate * max_seconds)
    soft = int(rate * min_seconds)
    end = min(len(samples), max(last, soft), hard)
    return samples[:end], end


def fade_out(samples, rate, ms=20):
    """Ramp the last few milliseconds to zero, so the note ends without a click."""
    n = min(len(samples), int(rate * ms / 1000.0))
    if n <= 0:
        return samples
    out = array.array('h', samples)
    for i in range(n):
        out[len(out) - n + i] = int(out[len(out) - n + i] * (1.0 - i / float(n)))
    return out


def remove_dc(samples):
    if not samples:
        return samples
    mean = sum(samples) / float(len(samples))
    return array.array('h', [_clip(s - mean) for s in samples])


def _clip(v):
    """16-bit signed, or it explodes."""
    if v > 32767:
        return 32767
    if v < -32768:
        return -32768
    return int(v)


def normalize(samples, target=0.9, max_gain=4.0):
    """Scale a note to a known peak, so every key in a voice is equally loud."""
    peak = peak_of(samples)
    if peak <= 0:
        return samples, 1.0
    gain = min(target / peak, max_gain)
    return array.array('h', [max(-32768, min(32767, int(s * gain))) for s in samples]), gain


def detect_pitch(samples, rate):
    """The fundamental of a note, in MIDI number. Returns None if unclear.

    Autocorrelation of a decimated signal, with a parabolic peak so the answer
    is not quantised to the sample rate. The smallest lag whose correlation is
    nearly the best one wins, which keeps a weak fundamental from being read
    as the octave above it.

    The range runs from 50 Hz to 1400 Hz on purpose: a Wurlitzer's tine bar
    rings at 74 Hz for its lowest sample, and a detector that cannot see that
    will happily report the tine partial a decade higher as the note.
    """
    if len(samples) < 2048:
        return None
    target = 8000
    step = max(1, int(rate // target))
    if step > 1:
        decimated = array.array('h')
        for i in range(0, len(samples) - step, step):
            chunk = samples[i:i + step]
            decimated.append(sum(chunk) // len(chunk))
    else:
        decimated = samples
    work = float(rate) / step
    # A short window is enough to see the period, and keeps the O(n * lags)
    # loop small: this runs in pure Python, once per extracted note.
    n = min(len(decimated), int(work * 0.35))
    if n < 512:
        return None
    mean = sum(decimated[:n]) / float(n)
    sig = [float(decimated[i]) - mean for i in range(n)]

    min_lag = max(2, int(work / 1400.0))
    max_lag = min(n - 2, int(work / 50.0))
    if max_lag <= min_lag:
        return None
    corr = [0.0] * (max_lag + 1)
    for lag in range(min_lag, max_lag + 1):
        total = 0.0
        for i in range(0, n - lag):
            total += sig[i] * sig[i + lag]
        corr[lag] = total
    best = max(corr[min_lag:max_lag + 1]) or 1e-9
    peak_lag = None
    for lag in range(min_lag, max_lag + 1):
        if corr[lag] >= best * 0.9:
            peak_lag = lag
            break
    if peak_lag is None:
        return None
    if 0 < peak_lag < max_lag:
        y0, y1, y2 = corr[peak_lag - 1], corr[peak_lag], corr[peak_lag + 1]
        denom = (y0 - 2 * y1 + y2)
        shift = 0.5 * (y0 - y2) / denom if denom else 0.0
    else:
        shift = 0.0
    freq = work / (peak_lag + shift)
    if freq <= 0:
        return None
    return 69.0 + 12.0 * math.log(freq / 440.0, 2)


def _safe_name(name):
    """A file name a URL will not trip over: no spaces, no brackets."""
    out = []
    for ch in name.strip().lower():
        out.append(ch if (ch.isalnum() or ch in '._-') else '-')
    return ''.join(out).strip('-') or 'sample'


def write_wav(path, samples, rate):
    with wave.open(path, 'wb') as w:
        w.setnchannels(CHANNELS)
        w.setsampwidth(SAMPLE_WIDTH)
        w.setframerate(rate)
        w.writeframes(samples.tobytes())


# ----------------------------------------------------------------- extract --

def _fft(re, im):
    """A radix-2 FFT, in place. No numpy on this machine, and none needed."""
    n = len(re)
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j |= bit
        if i < j:
            re[i], re[j] = re[j], re[i]
            im[i], im[j] = im[j], im[i]
    length = 2
    while length <= n:
        ang = -2 * math.pi / length
        wl = complex(math.cos(ang), math.sin(ang))
        half = length >> 1
        for i in range(0, n, length):
            w = 1 + 0j
            for k in range(i, i + half):
                u = complex(re[k], im[k])
                v = w * complex(re[k + half], im[k + half])
                re[k] = u.real + v.real
                im[k] = u.imag + v.imag
                re[k + half] = u.real - v.real
                im[k + half] = u.imag - v.imag
                w *= wl
        length <<= 1


def refine_pitch(samples, rate, around_midi, size=8192):
    """The strongest partial within a semitone and a half of `around_midi`.

    Autocorrelation finds roughly the right note; the spectrum finds it
    exactly. Doing both means the bank can tell us which note to look for
    and the spectrum can tell us how far off it really is - which is how a
    Rhodes sample that is 50 cents flat gets found and fixed instead of
    being played out of tune.
    """
    n = min(size, len(samples))
    if n < 1024:
        return None
    re = [0.0] * size
    im = [0.0] * size
    for i in range(n):
        re[i] = float(samples[i]) * (0.5 - 0.5 * math.cos(2 * math.pi * i / n))
    _fft(re, im)
    half = size // 2
    mag = [math.hypot(re[k], im[k]) for k in range(half)]
    binhz = rate / float(size)
    centre = 440.0 * (2 ** ((around_midi - 69.0) / 12.0))
    lo = max(2, int((centre * 2 ** (-1.5 / 12.0)) / binhz))
    hi = min(half - 2, int((centre * 2 ** (1.5 / 12.0)) / binhz))
    if hi <= lo:
        return None
    best_k = max(range(lo, hi + 1), key=lambda k: mag[k])
    if mag[best_k] <= 0:
        return None
    if 0 < best_k < half - 1:
        a, b, c = mag[best_k - 1], mag[best_k], mag[best_k + 1]
        den = (a - 2 * b + c)
        shift = 0.5 * (a - c) / den if den else 0.0
    else:
        shift = 0.0
    freq = (best_k + shift) * binhz
    if freq <= 0:
        return None
    return 69.0 + 12.0 * math.log(freq / 440.0, 2)


def measure_pitch(samples, rate, bank_root):
    """The key a sample really sounds at, in MIDI (a float).

    The bank's root key says which note to look for; the spectrum says how
    far off it is. Autocorrelation on its own is not enough: the top of a
    piano is so bright that its fundamental is barely there, and the
    correlation locks onto the rumble under the note instead. So the bank
    picks the neighbourhood, and the spectrum finds the peak in it.
    """
    heard = detect_pitch(samples, rate)
    candidates = []
    if bank_root is not None:
        candidates.append(bank_root)
    if heard is not None and (bank_root is None or abs(heard - bank_root) > 1.5):
        # The audio plainly disagrees with the bank - the Rhodes' C3 says 87
        # and means 60 - so let the audio lead.
        candidates.append(heard)
    for cand in candidates:
        exact = refine_pitch(samples, rate, cand)
        if exact is None or abs(exact - cand) > 1.5:
            continue        # nothing in that neighbourhood; try the next
        return exact
    return heard


def resolve_root(bank_root, measured):
    """Decide the key a sample was recorded at.

    The bank usually knows. But the Rhodes leaves the root key out for some
    samples, and the Wurlitzer never writes one at all - and where the bank
    does write one it is sometimes wrong by decades (the Rhodes' C3 says 87
    and means 60). So the recorded audio is the authority and the bank is the
    hint:

      * bank and measurement agree  -> use the bank's key, with the
        measurement's fine tuning, so a sample that is 50 cents flat in the
        bank still plays in tune;
      * the bank disagrees wildly   -> use the measurement;
      * there is no bank key         -> use the measurement.

    Returns (midi_key, cents) or None when neither source knows.
    """
    if measured is None:
        if bank_root is None:
            return None
        return (bank_root, 0)
    if bank_root is not None and abs(bank_root - measured) <= 1.5:
        return (bank_root, int(round((measured - bank_root) * 100)))
    root = int(round(measured))
    return (root, int(round((measured - root) * 100)))


def extract(sf, preset, keys, velocity, out_dir, args):
    """Extract one voice. Returns the manifest for it."""
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)

    chosen = {}          # sample id -> (instrument zone, root)
    key_ranges = {}      # sample id -> [first key, last key]
    key_list = {}        # sample id -> the exact keys this sample serves
    vel_ranges = {}      # sample id -> (lo, hi)
    loops = {}           # sample id -> (start, end) in frames
    atten = {}           # sample id -> centibels
    measured = {}        # sample id -> (root, cents)

    def measure(sid, zone):
        """The key a sample was recorded at, measured once and remembered."""
        if sid in measured:
            return measured[sid]
        raw, sh = sf.sample_pcm(sid)
        heard = measure_pitch(raw, sh['rate'], sf.root_key_of(zone['merged']))
        root = resolve_root(sf.root_key_of(zone['merged']), heard)
        measured[sid] = root
        return root

    zones = sf.voice_zones(preset, velocity)
    if not zones:
        raise ValueError('preset %r has no zone for velocity %d' % (preset, velocity))

    for key in keys:
        best = None
        for zone in zones:
            sid = zone['merged'][GEN_SAMPLE_ID]
            root = measure(sid, zone)
            if root is None:
                continue
            # The sample whose recorded key is nearest this key is the one a
            # player would reach for: transposition is what makes a sampled
            # instrument sound like a cheap toy.
            dist = abs(key - root[0])
            if best is None or (dist, sid) < (best[0], best[1]):
                best = (dist, sid, zone, root)
        if best is None:
            continue
        _, sid, zone, root = best
        if sid not in chosen:
            chosen[sid] = (zone, root)
            sh = sf._shdr[sid]
            loop = sf.loops(zone['inst'], sh)
            if loop:
                loops[sid] = loop
            # In an instrument zone, generator 41 is the level in centibels.
            atten[sid] = zone['inst'].get(GEN_INSTRUMENT, 0)
        rng = key_ranges.setdefault(sid, [key, key])
        rng[0] = min(rng[0], key)
        rng[1] = max(rng[1], key)
        key_list.setdefault(sid, set()).add(key)
        vrange = zone['merged'].get(GEN_VEL_RANGE)
        if vrange is not None:
            vlo, vhi = _range_of(vrange)
            prev = vel_ranges.get(sid)
            vel_ranges[sid] = (min(prev[0], vlo), max(prev[1], vhi)) if prev else (vlo, vhi)

    if not chosen:
        raise ValueError('preset %r has no zones covering keys %s at velocity %d'
                         % (preset, args.keys, velocity))

    samples = []
    for sid in sorted(chosen):
        zone, root = chosen[sid]
        raw, sh = sf.sample_pcm(sid)
        # SF2 attenuation is in centibels: 10 dB is 100 cB.
        gain = 10 ** (-atten[sid] / 200.0)
        scaled = array.array('h', [_clip(s * gain) for s in raw])
        trimmed, length = trim_tail(scaled, sh['rate'], args.trim_db,
                                     args.max_seconds, args.min_seconds)
        trimmed = remove_dc(trimmed)
        trimmed = fade_out(trimmed, sh['rate'])
        samples.append({
            'id': sid, 'sh': sh, 'audio': trimmed, 'length': length,
            'root': root[0], 'cents': root[1], 'atten': atten[sid],
            'keys': key_ranges[sid], 'keyList': sorted(key_list[sid]),
            'vel': vel_ranges.get(sid, (0, 127)),
            'loop': loops.get(sid),
        })

    # One loudness for the whole voice. The scale is baked into the WAV, so
    # the browser plays it at 1.0 - but a quiet note may be lifted a little,
    # because a game that cannot hear the top of the grid is not a game.
    peak = max([peak_of(s['audio']) for s in samples] + [1])
    target = 0.9 * 32767
    base = min(target / peak, 4.0)
    boost_cap = base * 2.0

    manifest = []
    for s in samples:
        p = peak_of(s['audio']) or 1
        scale = min(boost_cap, target / p)
        audio = array.array('h', [max(-32768, min(32767, int(v * scale))) for v in s['audio']])
        name = _safe_name(s['sh']['name'])
        fname = '%s-%d.wav' % (name, s['id'])
        path = os.path.join(out_dir, fname)
        write_wav(path, audio, s['sh']['rate'])

        found = measure_pitch(audio, s['sh']['rate'], s['root'])
        expect = s['root'] + s['cents'] / 100.0
        note = ''
        if found is not None:
            cents_off = (found - expect) * 100.0
            note = 'detected %+.1f semitones off root' % (cents_off / 100.0)
            if abs(cents_off) > 60:
                note += '  <-- TOO FAR, check the root key'
        else:
            note = 'pitch not detected'

        loop_start = loop_end = 0.0
        if s['loop']:
            ls, le = s['loop']
            if 0 <= ls < le <= s['length']:
                loop_start = ls / float(s['sh']['rate'])
                loop_end = le / float(s['sh']['rate'])
            else:
                note += '  (loop region trimmed away)'

        manifest.append({
            'file': fname,
            'rootKey': s['root'],
            'rate': s['sh']['rate'],
            'keyLo': s['keys'][0],
            'keyHi': s['keys'][1],
            'keys': s['keyList'],
            'velLo': s['vel'][0],
            'velHi': s['vel'][1],
            'gain': 1.0,
            'dur': round(len(audio) / float(s['sh']['rate']), 3),
            'loopStart': round(loop_start, 4),
            'loopEnd': round(loop_end, 4),
            'cents': s['cents'],
        })
        print('  %-28s root %3d  keys %3d-%3d (%2d)  vel %3d-%3d  %5.2fs  %6.1fkB  x%.2f  %s'
              % (fname, s['root'], s['keys'][0], s['keys'][1], len(s['keyList']),
                 s['vel'][0], s['vel'][1],
                 len(audio) / float(s['sh']['rate']), os.path.getsize(path) / 1024.0,
                 scale, note))
    return manifest


def write_manifest(out_dir, voice, preset, manifest):
    """Write the voice's manifests and refresh bank.js.

    Two manifests, on purpose:
      * <voice>.js  - what the browser imports. It carries an explicit
        new URL() per file, which is the only form Vite rewrites into a
        hashed asset URL at build time.
      * <voice>.json - the same data without the URLs, for the test that
        checks the committed audio actually sounds like what it claims.
    """
    lines = []
    lines.append('// GENERATED by games/clicker/tools/extract_sf2.py - do not edit by hand.')
    lines.append('// Source: %s, preset %r.' % (os.path.basename(preset[0]), preset[1]))
    lines.append('export const %s = {' % voice)
    lines.append("  name: '%s'," % voice)
    lines.append('  samples: [')
    for m in manifest:
        lines.append('    {')
        lines.append("      file: '%s'," % m['file'])
        lines.append("      url: new URL('./%s/%s', import.meta.url).href," % (voice, m['file']))
        for key in ('rootKey', 'rate', 'keyLo', 'keyHi', 'keys', 'velLo', 'velHi', 'gain', 'dur', 'loopStart', 'loopEnd', 'cents'):
            lines.append('      %s: %s,' % (key, json.dumps(m[key])))
        lines.append('    },')
    lines.append('  ]')
    lines.append('};')
    lines.append('')
    path = os.path.join(out_dir, voice + '.js')
    with open(path, 'w') as fh:
        fh.write('\n'.join(lines))

    with open(os.path.join(out_dir, voice + '.json'), 'w') as fh:
        json.dump({'name': voice, 'source': os.path.basename(preset[0]),
                   'preset': preset[1], 'samples': manifest}, fh, indent=2, sort_keys=True)
        fh.write('\n')

    # bank.js lists every voice that exists, so adding one is just a re-run.
    voices = sorted(f[:-3] for f in os.listdir(out_dir)
                    if f.endswith('.js') and f != 'bank.js')
    out = ['// GENERATED by games/clicker/tools/extract_sf2.py - do not edit by hand.']
    for v in voices:
        out.append("import { %s } from './%s.js';" % (v, v))
    out.append('')
    out.append('export const BANK = {')
    for v in voices:
        out.append('  %s,' % v)
    out.append('};')
    out.append('')
    with open(os.path.join(out_dir, 'bank.js'), 'w') as fh:
        fh.write('\n'.join(out))
    return path


def check_bank(out_dir, key_lo=55, key_hi=87, tol=0.35):
    """Check the committed bank: does every sample exist, and does it sound
    like the key the manifest says it does?

    This is the test that matters. A soundfont can be parsed perfectly and
    still give you the wrong note, and nobody finds out until a player does.
    """
    problems = []
    voices = sorted(f[:-5] for f in os.listdir(out_dir) if f.endswith('.json'))
    if not voices:
        return ['no voice manifests in ' + out_dir]
    for voice in voices:
        with open(os.path.join(out_dir, voice + '.json')) as fh:
            data = json.load(fh)
        covered = set()
        for s in data['samples']:
            path = os.path.join(out_dir, voice, s['file'])
            if not os.path.isfile(path):
                problems.append('%s/%s is missing' % (voice, s['file']))
                continue
            with wave.open(path, 'rb') as w:
                rate = w.getframerate()
                frames = w.getnframes()
                width = w.getsampwidth()
                channels = w.getnchannels()
                audio = array.array('h')
                audio.frombytes(w.readframes(frames))
            if width != 2 or channels != 1:
                problems.append('%s/%s is not 16-bit mono' % (voice, s['file']))
            if rate != s['rate']:
                problems.append('%s/%s: manifest says %d Hz, the file is %d Hz'
                                % (voice, s['file'], s['rate'], rate))
            dur = frames / float(rate)
            if abs(dur - s['dur']) > 0.02:
                problems.append('%s/%s: manifest says %.3fs, the file is %.3fs'
                                % (voice, s['file'], s['dur'], dur))
            found = measure_pitch(audio, rate, s['rootKey'])
            expect = s['rootKey'] + s['cents'] / 100.0
            if found is None:
                problems.append('%s/%s: no pitch could be measured' % (voice, s['file']))
            elif abs(found - expect) > tol:
                problems.append('%s/%s: measured %.2f, the manifest says %.2f'
                                % (voice, s['file'], found, expect))
            if s['loopEnd'] > 0:
                if not (0 < s['loopStart'] < s['loopEnd'] <= dur):
                    problems.append('%s/%s: the loop (%.3f-%.3f) is not inside the note'
                                    % (voice, s['file'], s['loopStart'], s['loopEnd']))
            covered.update(s['keys'])
        missing = [k for k in range(key_lo, key_hi + 1) if k not in covered]
        if missing:
            problems.append('%s does not cover keys %s' % (voice, missing))
    return problems


def parse_range(spec):
    """'55-87' -> (55, 87)."""
    lo, hi = spec.split('-')
    return int(lo), int(hi)


def parse_keys(spec):
    lo, hi = parse_range(spec)
    return list(range(lo, hi + 1))


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--sf2', help='the soundfont to read')
    ap.add_argument('--preset', help='preset name inside it')
    ap.add_argument('--voice', help='name for the extracted voice')
    ap.add_argument('--keys', default='55-87', help='MIDI keys to keep, e.g. 55-87')
    ap.add_argument('--velocity', type=int, default=100, help='which velocity layer to keep')
    ap.add_argument('--out', required=True, help='samples directory')
    ap.add_argument('--trim-db', type=float, default=-50.0, help='tail cut threshold in dB')
    ap.add_argument('--max-seconds', type=float, default=4.0)
    ap.add_argument('--min-seconds', type=float, default=1.2)
    ap.add_argument('--check', action='store_true',
                    help='check the bank in --out instead of extracting one')
    args = ap.parse_args(argv)

    if args.check:
        lo, hi = parse_range(args.keys)
        problems = check_bank(args.out, lo, hi)
        for p in problems:
            print('PROBLEM: ' + p)
        if problems:
            return 1
        print('bank in %s is good: every note is present and sounds like its key' % args.out)
        return 0

    if not os.path.isfile(args.sf2 or ''):
        print('no such soundfont: ' + str(args.sf2), file=sys.stderr)
        return 2
    if not args.preset or not args.voice:
        print('--preset and --voice are needed when extracting', file=sys.stderr)
        return 2

    print('reading %s' % args.sf2)
    sf = SoundFont(args.sf2)
    keys = parse_keys(args.keys)
    voice_dir = os.path.join(args.out, args.voice)
    print('extracting preset %r -> %s' % (args.preset, voice_dir))
    manifest = extract(sf, args.preset, keys, args.velocity, voice_dir, args)
    path = write_manifest(args.out, args.voice, (args.sf2, args.preset), manifest)
    total = sum(os.path.getsize(os.path.join(voice_dir, m['file'])) for m in manifest)
    print('wrote %s (%d notes, %.1f kB)' % (path, len(manifest), total / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
