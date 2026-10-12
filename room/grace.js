// BubHub v10 — host grace period. Replaces election / stagger / probeRoom.
// Host drops -> guests see "host reconnecting…" for GRACE_MS while redialing
// the same room id. On expiry the room closes and the UI offers a fresh room
// with usernames retained.
export const GRACE_MS = 30000;

export function createGrace(onTick, onExpire) {
  let deadline = 0;
  let timer = null;

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    deadline = 0;
  }

  function start() {
    stop();
    deadline = Date.now() + GRACE_MS;
    timer = setInterval(function () {
      const left = Math.max(0, deadline - Date.now());
      try { onTick(Math.ceil(left / 1000), left / GRACE_MS); } catch (e) {}
      if (left <= 0) {
        stop();
        try { onExpire(); } catch (e) {}
      }
    }, 250);
  }

  return {
    start: start,
    stop: stop,
    get active() { return timer !== null; },
    get remaining() { return Math.max(0, deadline - Date.now()); }
  };
}
