// BubHub v10 — QR invite plugin (progressive enhancement).
// Uses the `qrcode` npm package when bundled via Vite; falls back to a
// copyable link box when offline / package missing. Never blocks the room.
export function createQr(opts) {
  const getLink = opts.getLink;
  let QR = null;
  try {
    // bundled only; plain http.server keeps QR null and shows the link instead
    QR = null;
  } catch (e) { QR = null; }

  async function render(box) {
    if (!box) return;
    box.innerHTML = '';
    const link = getLink();
    if (!link) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (QR && typeof QR.toCanvas === 'function') {
      const cv = document.createElement('canvas');
      box.appendChild(cv);
      try { await QR.toCanvas(cv, link, { width: 160, margin: 1 }); } catch (e) {
        linkFallback(box, link);
      }
    } else {
      // No QR lib (offline dev): show a scannable-size link + copy button.
      linkFallback(box, link);
    }
  }

  function linkFallback(box, link) {
    const p = document.createElement('p');
    p.className = 'text-xs text-slate-800 break-all mb-1';
    p.textContent = link;
    const b = document.createElement('button');
    b.className = 'bg-slate-800 text-white rounded px-2 py-1 text-xs font-bold';
    b.textContent = 'Copy invite link';
    b.addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(link).catch(function () {});
    });
    box.appendChild(p);
    box.appendChild(b);
    const note = document.createElement('p');
    note.className = 'text-[10px] text-slate-500 mt-1';
    note.textContent = 'QR needs the bundled app (npm run dev). Link works everywhere.';
    box.appendChild(note);
  }

  function wire() {
    const t = document.getElementById('qr-toggle');
    const box = document.getElementById('qr-box');
    if (t && box) {
      t.addEventListener('change', function () {
        if (t.checked) render(box);
        else { box.classList.add('hidden'); box.innerHTML = ''; }
      });
    }
  }

  return { render: render, wire: wire };
}
