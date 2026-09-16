// storage.js
// Saves progress in the browser so a day's game survives a refresh. State is
// keyed by day number (and by mode, so a day's Hard-Mode board is independent
// of its normal grid board).

const KEY_PREFIX = 'colordle:day:';

/** localStorage key for a day + mode ('normal' | 'hard'). */
function keyFor(dayNumber, mode) {
  return KEY_PREFIX + dayNumber + (mode === 'hard' ? ':hard' : '');
}

/** Load saved state for a day, or null if none / unreadable. */
export function loadState(dayNumber, mode = 'normal') {
  try {
    const raw = localStorage.getItem(keyFor(dayNumber, mode));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Persist state for a day. Silently ignores storage errors (private mode etc.). */
export function saveState(dayNumber, state, mode = 'normal') {
  try {
    localStorage.setItem(keyFor(dayNumber, mode), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}
