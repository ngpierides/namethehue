// supabase/functions/create-portal/index.ts
//
// Returns a Stripe Customer Portal URL for the logged-in player, so they can
// manage or CANCEL their Name the Hue Pro subscription themselves (and update their
// card / view invoices). Mirrors create-checkout. A self-serve cancel here fires
// `customer.subscription.deleted`, which the stripe-webhook turns back into a
// dropped entitlement — no extra code needed.
//
// One-time setup: activate the portal in Stripe → Settings → Billing → Customer
// portal (and enable "Cancel subscriptions"). See SUPABASE_SETUP.md, Step 10.
//
// Required function secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: 'Not logged in' }, 401);

    const { returnUrl } = await req.json().catch(() => ({}));
    const base = returnUrl || Deno.env.get('SITE_URL') || '';

    const { data: row } = await supabase
      .from('player_stats')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    const customer = row?.stripe_customer_id as string | undefined;
    if (!customer) return json({ error: 'No subscription on file' }, 400);

    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: base,
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
