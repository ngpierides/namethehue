// supabase/functions/delete-account/index.ts
//
// Permanently deletes the logged-in player's account. The browser calls this via
// supabase.functions.invoke('delete-account'); the user's JWT identifies them, so
// a player can only ever delete THEIR OWN account. Runs on Supabase Edge (Deno).
//
// The auth user is removed with the service-role admin API; their `player_stats`
// row is dropped automatically by the `on delete cascade` FK (see SUPABASE_SETUP.md,
// Step 4). If Stripe is configured and they have a live subscription, we cancel it
// first (best-effort) so a deleted account is never billed again.
//
// Required function secrets (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are provided
// by the Edge runtime; STRIPE_SECRET_KEY only needed once you charge for Pro):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (auto-provided)
//   STRIPE_SECRET_KEY                          sk_live_… / sk_test_… (optional)

import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Identify the caller from their JWT (Authorization header).
    const asUser = createClient(url, serviceKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Not logged in' }, 401);

    // Service-role client (no user header) for the row read + admin delete.
    const admin = createClient(url, serviceKey);

    // Best-effort: stop any live Stripe subscription so a deleted account isn't
    // billed. Only when Stripe is configured; a failure here never blocks deletion.
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (stripeKey) {
      try {
        const { data: row } = await admin
          .from('player_stats')
          .select('stripe_subscription_id')
          .eq('user_id', user.id)
          .maybeSingle();
        const subId = row?.stripe_subscription_id as string | undefined;
        if (subId) {
          const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });
          await stripe.subscriptions.cancel(subId);
        }
      } catch (e) {
        console.warn('delete-account: stripe cancel failed', e);
      }
    }

    // Delete the auth user; player_stats cascades via the FK.
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
