// supabase/functions/get-prices/index.ts
//
// Returns the live monthly/yearly pricing for Name the Hue Pro so the UI can show
// real amounts and the annual saving, straight from Stripe (one source of truth,
// no hardcoded numbers to drift). Public pricing - no user needed. Reads the same
// price IDs as create-checkout.
//
// Required function secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_ID,
//   STRIPE_PRICE_ID_YEARLY (optional).

import Stripe from 'https://esm.sh/stripe@14?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});
const MONTHLY = Deno.env.get('STRIPE_PRICE_ID')!;
const YEARLY = Deno.env.get('STRIPE_PRICE_ID_YEARLY') || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const [m, y] = await Promise.all([
      stripe.prices.retrieve(MONTHLY),
      YEARLY ? stripe.prices.retrieve(YEARLY) : Promise.resolve(null),
    ]);

    const shape = (p: Stripe.Price | null) =>
      p && {
        amount: p.unit_amount, // minor units (e.g. cents)
        currency: p.currency,
        interval: p.recurring?.interval, // 'month' | 'year'
      };

    return json({ monthly: shape(m), yearly: shape(y) });
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
