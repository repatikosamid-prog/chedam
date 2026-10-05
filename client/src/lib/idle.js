// Idle auto-lock (NFR-11, DL-32): after security.auto_lock_minutes without a tap or key press,
// the person is signed out on this device and the name list comes back.

const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"];

export function watchIdle(getMinutes, isSignedIn, onIdle) {
  let last = Date.now();
  const bump = () => { last = Date.now(); };
  EVENTS.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
  const timer = setInterval(() => {
    if (!isSignedIn()) { last = Date.now(); return; }
    if (Date.now() - last >= getMinutes() * 60000) { last = Date.now(); onIdle(); }
  }, 15000);
  return () => { clearInterval(timer); EVENTS.forEach((ev) => window.removeEventListener(ev, bump)); };
}
