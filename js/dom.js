// dom.js
// Tiny shared DOM helpers used across the modals and boards, so the same
// snippet isn't copy-pasted (and allowed to drift) in five files.

/** Escape a string for safe interpolation into innerHTML (incl. attributes). */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Briefly swap an element's text (e.g. a button to "Copied!") then restore it.
 * @param {{ ms?:number, disable?:boolean, restoreTo?:string }} [opts]
 */
export function flash(el, msg, { ms = 1400, disable = false, restoreTo } = {}) {
  if (!el) return;
  const original = restoreTo ?? el.textContent;
  el.textContent = msg;
  if (disable) el.disabled = true;
  setTimeout(() => {
    el.textContent = original;
    if (disable) el.disabled = false;
  }, ms);
}
