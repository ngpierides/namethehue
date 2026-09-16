// supabase/functions/create-checkout/index.ts
//
// Creates a Stripe Checkout Session for the logged-in Name the Hue player and
// returns its URL. The browser calls this via supabase.functions.invoke(); the
// user's JWT identifies them. Runs on Supabase Edge Functions (Deno).
//
// Required function secrets (set with `supabase secrets set …`):
//   STRIPE_SECRET_KEY            sk_live_… / sk_test_…
//   STRIPE_PRICE_ID              price_…  (your MONTHLY Pro price)
//   STRIPE_PRICE_ID_YEARLY       price_…  (your YEARLY Pro price; optional)
//   STRIPE_TRIAL_DAYS            free-trial length; optional, defaults to 7
//   SUPABASE_URL                 (auto-provided in the Edge runtime)
//   SUPABASE_SERVICE_ROLE_KEY    (auto-provided in the Edge runtime)

import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});
const PRICE_MONTHLY = Deno.env.get('STRIPE_PRICE_ID')!;
const PRICE_YEARLY = Deno.env.get('STRIPE_PRICE_ID_YEARLY') || '';
const TRIAL_DAYS = Number(Deno.env.get('STRIPE_TRIAL_DAYS') ?? '7');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // A service-role client scoped with the caller's JWT: getUser() resolves the
    // logged-in player, writes bypass RLS + the entitlement guard trigger.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: 'Not logged in' }, 401);

    const { returnUrl, plan } = await req.json().catch(() => ({}));
    const base = returnUrl || Deno.env.get('SITE_URL') || '';

    // Pick the price: 'yearly' when asked (and configured), else the monthly one.
    const price = plan === 'yearly' && PRICE_YEARLY ? PRICE_YEARLY : PRICE_MONTHLY;

    // Reuse the player's Stripe customer if we made one before; otherwise let
    // Checkout create it from their email. Skipping a pre-emptive customers.create
    // saves a Stripe round trip (the webhook stores the id after they pay).
    const { data: row } = await supabase
      .from('player_stats')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const customer = row?.stripe_customer_id as string | undefined;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ...(customer ? { customer } : { customer_email: user.email ?? undefined }),
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id, // how the webhook maps payment -> user
      allow_promotion_codes: true,  // lets you hand out discount / 100%-off codes
      // A free trial: Stripe still collects the card now, charges after N days.
      // The webhook treats 'trialing' as active, so Pro unlocks immediately.
      subscription_data: TRIAL_DAYS > 0 ? { trial_period_days: TRIAL_DAYS } : undefined,
      success_url: `${base}?pro=success`,
      cancel_url: `${base}?pro=cancel`,
    });

    return json({ url: session.url });
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
