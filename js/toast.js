// toast.js
// A tiny, dependency-free toast for transient messages - the game has no other
// notification surface, so billing status and payment-return confirmations use
// this instead of window.alert(). One reused element, auto-dismiss, or sticky
// (duration:0) while an async action resolves.

let el = null;

function ensure() {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'toast';
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  document.body.appendChild(el);
  return el;
}

/**
 * Show a toast. `duration:0` keeps it up until the next showToast/hideToast.
 * @returns {() => void} a dismiss function
 */
export function showToast(msg, { duration = 3400 } = {}) {
  const t = ensure();
  t.textContent = msg;
  t.classList.add('is-show');
  clearTimeout(t._timer);
  if (duration > 0) t._timer = setTimeout(hideToast, duration);
  return hideToast;
}

export function hideToast() {
  if (el) el.classList.remove('is-show');
}
