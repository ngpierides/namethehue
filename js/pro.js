// pro.js
// The optional "Pro" tier. Like auth.js's Supabase seam, this hides HOW the
// entitlement is stored so nothing else has to care. Two modes:
//
//   • LOCAL mode (Supabase not configured): Pro is a free self-serve toggle in
//     localStorage - the original offline/dev behaviour, unchanged.
//   • CLOUD mode (Supabase configured): Pro is granted by the SERVER. auth.js
//     pulls the player's `pro_source` (`comp` / `admin` / `paid`) from their
//     stats row and calls applyEntitlement(); the local toggle is ignored. The
//     browser can only ever READ its entitlement - `pro_source` is writable
//     solely with the service-role key (a Stripe webhook, or your own admin
//     script), never from front-end code. See SUPABASE_SETUP.md.
//
// Pro unlocks Hard Mode (mix the colour with a picker), the past-games Archive,
// and unlimited Practice. Free players get today's grid puzzle only.

const PRO_KEY = 'colordle:pro';         // local-mode self-serve toggle
const HARD_KEY = 'colordle:hardmode';   // Hard-Mode sub-preference (client-only)
const ENT_CACHE = 'colordle:entitled';  // cloud-mode: cache of the last server answer
const ENT_SRC = 'colordle:prosrc';      // cloud-mode: cache of how Pro was granted

const listeners = [];

let cloudMode = false;     // true when Supabase is the authority for Pro
let cloudEntitled = false; // server truth (only meaningful in cloud mode)
let cloudSource = null;    // 'paid' | 'comp' | 'admin' | null - how Pro was granted

function read(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function write(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* private mode */ }
}
function readStr(key) {
  try { return localStorage.getItem(key) || null; } catch { return null; }
}
function writeStr(key, val) {
  try { if (val) localStorage.setItem(key, val); else localStorage.removeItem(key); } catch { /* private */ }
}

/**
 * Tell pro.js which mode we're in. Called once at boot from main.js with
 * isConfigured(). In cloud mode we seed from the cached answer so a returning
 * Pro player sees Pro immediately; auth.js then reconciles with the real row.
 */
export function setCloudMode(on) {
  cloudMode = !!on;
  if (cloudMode) { cloudEntitled = read(ENT_CACHE); cloudSource = readStr(ENT_SRC); }
}

/** Is Pro decided by the server (vs the local dev toggle)? */
export function isCloudManaged() {
  return cloudMode;
}

/** How Pro was granted: 'paid' | 'comp' | 'admin' | null. Only 'paid' is manageable in Stripe. */
export function proSource() {
  return cloudMode ? cloudSource : null;
}

/** Is the Pro tier unlocked? */
export function isPro() {
  return cloudMode ? cloudEntitled : read(PRO_KEY);
}

/**
 * Apply the entitlement carried on the player's stats row (cloud mode only).
 * `null` (signed out, or no row yet) resolves to free. A `paid` grant only
 * counts while the subscription period is still current. Fires onProChange when
 * the answer changes, so the board repaints.
 */
export function applyEntitlement(row) {
  cloudMode = true;
  const src = row && row.pro_source;
  const paidActive =
    src === 'paid' &&
    row.pro_current_period_end &&
    new Date(row.pro_current_period_end).getTime() > Date.now();
  const next = src === 'admin' || src === 'comp' || paidActive;
  const changed = next !== cloudEntitled;
  cloudEntitled = next;
  cloudSource = next ? src : null;
  write(ENT_CACHE, next);
  writeStr(ENT_SRC, cloudSource);
  if (!next) write(HARD_KEY, false); // can't linger in Hard Mode without Pro
  if (changed) emit();
}

/** Unlock / relock Pro - only meaningful in LOCAL mode; a no-op under the cloud. */
export function setPro(on) {
  if (cloudMode) return; // server-driven; the local toggle can't grant Pro
  write(PRO_KEY, on);
  if (!on) write(HARD_KEY, false); // hard mode is a Pro-only sub-setting
  emit();
}

/** Is Hard Mode active? (Only ever true while Pro is on.) */
export function isHardMode() {
  return isPro() && read(HARD_KEY);
}

export function setHardMode(on) {
  if (!isPro()) return;
  write(HARD_KEY, on);
  emit();
}

/** Subscribe to Pro / Hard-Mode changes (e.g. to re-render the board). */
export function onProChange(fn) {
  listeners.push(fn);
}

function emit() {
  listeners.forEach((f) => { try { f(); } catch { /* ignore */ } });
}
