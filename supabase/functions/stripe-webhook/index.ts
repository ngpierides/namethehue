// supabase/functions/stripe-webhook/index.ts
//
// The single source of truth for PAID Pro. Stripe calls this on subscription
// lifecycle events; we verify the signature, then write pro_source='paid' (and
// the period end) with the service-role key. Nothing else may set 'paid'.
//
// Deploy WITHOUT JWT verification (Stripe isn't a Supabase user):
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// Required function secrets:
//   STRIPE_SECRET_KEY            sk_live_… / sk_test_…
//   STRIPE_WEBHOOK_SECRET        whsec_…  (from the Stripe webhook endpoint)
//   SUPABASE_URL                 (auto-provided)
//   SUPABASE_SERVICE_ROLE_KEY    (auto-provided)

import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

// Plain service-role client — no user JWT; the webhook acts as the system.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text(); // raw body required for signature verification
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, WEBHOOK_SECRET);
  } catch (e) {
    return new Response(`Bad signature: ${(e as Error).message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription as string);
          await grant(s.client_reference_id as string, s.customer as string, sub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await userForCustomer(sub.customer as string);
        if (userId) await grant(userId, sub.customer as string, sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await userForCustomer(sub.customer as string);
        if (userId) await revoke(userId);
        break;
      }
    }
  } catch (e) {
    console.error('webhook handler error', e);
    return new Response('handler error', { status: 500 }); // Stripe will retry
  }

  return new Response('ok');
});

async function grant(userId: string, customer: string, sub: Stripe.Subscription) {
  const active = sub.status === 'active' || sub.status === 'trialing';
  // `current_period_end` moved from the subscription onto its items in recent API
  // versions (2025 "basil" onward, incl. dahlia). Read the item first and fall
  // back to the legacy top-level field, so this works on any account API version.
  const periodEnd =
    sub.items?.data?.[0]?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  await supabase.from('player_stats').upsert(
    {
      user_id: userId,
      stripe_customer_id: customer,
      stripe_subscription_id: sub.id,
      pro_source: active ? 'paid' : null,
      pro_current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    },
    { onConflict: 'user_id' },
  );
}

async function revoke(userId: string) {
  // Only clear a PAID grant — never clobber a 'comp' or 'admin' entitlement.
  await supabase
    .from('player_stats')
    .update({ pro_source: null })
    .eq('user_id', userId)
    .eq('pro_source', 'paid');
}

async function userForCustomer(customer: string): Promise<string | null> {
  const { data } = await supabase
    .from('player_stats')
    .select('user_id')
    .eq('stripe_customer_id', customer)
    .maybeSingle();
  return data?.user_id ?? null;
}
