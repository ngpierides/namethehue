// billing.js
// Client side of Name the Hue Pro payments. All the trust lives server-side in the
// Supabase Edge Functions (create-checkout, stripe-webhook); this module just
// asks the function for a Stripe URL and opens it. It never sees card details
// (Stripe's hosted page handles those) and never grants Pro itself - the webhook
// writes the entitlement, and the app reflects it on the next sync. See
// SUPABASE_SETUP.md, Step 9.

import { getSupabaseClient, getSession, isConfigured } from './auth.js';
import { showToast } from './toast.js';

let inFlight = false; // guards against double-clicks opening two windows

// A small window, centred horizontally and a little above centre over the game.
function popupFeatures() {
  const w = 460;
  const h = Math.min(760, (screen.availHeight || 800) - 60);
  const baseX = window.screenLeft ?? window.screenX ?? 0;
  const baseY = window.screenTop ?? window.screenY ?? 0;
  const ow = window.outerWidth || screen.availWidth || w;
  const oh = window.outerHeight || screen.availHeight || h;
  const left = Math.round(baseX + Math.max(0, (ow - w) / 2));
  const top = Math.round(baseY + Math.max(0, (oh - h) / 2 - 40));
  return `popup=1,width=${w},height=${h},left=${left},top=${top}`;
}

// Name the Hue-styled holding screen shown in the popup while Stripe loads, so the
// hand-off doesn't flash a blank/alien page. (Theme-aware via prefers-color-scheme.)
const HOLDING_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Name the Hue Pro</title><style>
:root{color-scheme:light dark}
body{margin:0;height:100vh;display:grid;place-items:center;
font-family:'Space Grotesk',system-ui,sans-serif;background:#f6f1e7;color:#211d18}
@media(prefers-color-scheme:dark){body{background:#1f1913;color:#efe7d6}}
.wrap{text-align:center}
.dot{width:16px;height:16px;border-radius:4px;background:#c0472d;display:inline-block;
box-shadow:-22px 0 0 -1px #e0a53f,22px 0 0 -1px #3f7fb0;margin-bottom:22px}
p{font-size:15px;opacity:.75}</style></head>
<body><div class="wrap"><div class="dot"></div><p>Opening secure checkout…</p></div></body></html>`;

/**
 * Start a Stripe Checkout session for the logged-in player.
 * @param {'monthly'|'yearly'} [plan] which price to buy (defaults to monthly)
 */
export function startCheckout(plan = 'monthly') {
  return stripeFlow({
    fn: 'create-checkout',
    body: { returnUrl: location.origin + location.pathname, plan },
    opening: 'Opening secure checkout…',
    failed: 'Sorry - could not start checkout.',
  });
}

/** Open the Stripe Customer Portal so the player can manage / cancel their sub. */
export function openPortal() {
  return stripeFlow({
    fn: 'create-portal',
    body: { returnUrl: location.origin + location.pathname },
    opening: 'Opening your billing portal…',
    failed: 'Sorry - could not open the billing portal.',
  });
}

/**
 * Shared flow: open a tab *synchronously* (so popup blockers allow it), ask the
 * Edge Function for the Stripe URL, then point the tab at it. Falls back to the
 * same tab if the popup was blocked; closes the tab and reports if it fails.
 */
async function stripeFlow({ fn, body, opening, failed }) {
  if (!isConfigured()) { showToast('Payments need Supabase configured first.'); return; }
  if (!getSession()) { showToast('Please log in (profile icon) first, then subscribe.'); return; }
  if (inFlight) return;
  inFlight = true;

  // Open a small window centred (a touch above centre) over the game NOW, inside
  // the click gesture, so popup blockers allow it. We fill the real URL once the
  // server hands it back; a Name the Hue-styled holding screen shows meanwhile.
  const win = window.open('about:blank', 'colordle-checkout', popupFeatures());
  if (win) {
    try { win.document.write(HOLDING_HTML); } catch { /* ignore */ }
    try { win.focus(); } catch { /* ignore */ }
  }
  showToast(opening, { duration: 0 });

  try {
    const client = await getSupabaseClient();
    if (!client) throw new Error('server unreachable');
    const { data, error } = await client.functions.invoke(fn, { body });
    if (error) throw error;
    const url = data?.url;
    if (!url) throw new Error(data?.error || 'No URL returned');

    if (win) win.location.href = url; // fill the window we already opened
    else location.href = url;         // popup blocked: fall back to this tab
    showToast('Complete your subscription in the checkout window.');
  } catch (e) {
    console.warn('[Name the Hue] stripe flow failed', e);
    win?.close();
    showToast(`${failed} ${e?.message || ''}`.trim());
  } finally {
    inFlight = false;
  }
}
