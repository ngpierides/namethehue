// supabase/functions/get-revenue/index.ts
//
// Admin-only: live Stripe balance for the dashboard's revenue card. Returns the
// account balance per currency as { available, pending } minor units — pending is
// money captured but not yet cleared for payout ("upcoming payments"). Mirrors the
// get-prices function; the only extra is an admin check (same app_metadata.role
// gate as get_game_stats), so a signed-in non-admin can't read your balance.
//
// Required function secrets: STRIPE_SECRET_KEY (already set for the other Stripe
// functions). SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-provided.

import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // Resolve the caller from their JWT and require the admin role.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.app_metadata?.role !== 'admin') return json({ error: 'not authorized' }, 403);

    // One call: available + pending, each an array of {amount, currency}. A Stripe
    // account can hold several currencies (you're mid AUD->USD switch), so keep
    // them separate — you can't add AUD to USD.
    const bal = await stripe.balance.retrieve();
    const byCur: Record<string, { available: number; pending: number }> = {};
    const bump = (arr: { amount: number; currency: string }[], key: 'available' | 'pending') =>
      arr.forEach((x) => { (byCur[x.currency] ??= { available: 0, pending: 0 })[key] = x.amount; });
    bump(bal.available, 'available');
    bump(bal.pending, 'pending');
    const balances = Object.entries(byCur).map(([currency, v]) => ({ currency, ...v }));

    return json({ balances });
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
