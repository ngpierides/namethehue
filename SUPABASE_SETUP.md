# Setting up Supabase for Colordle

This turns on **accounts + cross-device saving**. Budget ~10 minutes. You don't
need to write any code — just click through the Supabase dashboard and paste two
values into one file.

> Colordle works **without** this. If you skip it, players just play as "guests"
> and their stats save in their own browser. Do this only when you want real logins.

---

## Step 1 — Create a Supabase project

1. Go to **[supabase.com](https://supabase.com)** and click **Start your project**
   / **Sign in**. Sign up with GitHub or email (it's free).
2. In the dashboard, click **New project**.
3. Fill in:
   - **Name**: e.g. `colordle`
   - **Database Password**: click *Generate*, then **save it somewhere safe**
     (you won't need it for Colordle, but you don't want to lose it).
   - **Region**: pick the one closest to most of your players.
   - **Plan**: **Free** is plenty.
4. Click **Create new project** and wait ~2 minutes while it provisions.

---

## Step 2 — Copy your two keys

1. In the left sidebar open **Settings** (the gear) → **API**.
   (In some newer dashboards this is **Project Settings → API Keys / Data API**.)
2. You need exactly two things:

   | What you need | Where it is | Looks like |
   |---|---|---|
   | **Project URL** | "Project URL" | `https://abcdefgh.supabase.co` |
   | **anon / public key** | "Project API keys" → **`anon` `public`** (newer projects may call it the **publishable** key) | a long `eyJhbGci...` string (or `sb_publishable_...`) |

> ⚠️ **Use the `anon` / `public` key only.** Never put the **`service_role`** (or
> **`secret`**) key in front-end code — it bypasses all security. The anon key is
> *designed* to be public; your data is protected by the RLS policies in Step 4.

---

## Step 3 — Paste them into Colordle

Open **`js/supabase-config.js`** and replace the placeholders:

```js
export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6...';
```

Save the file. (If you'd already loaded the page, hard-refresh: **Cmd/Ctrl + Shift + R**.)

---

## Step 4 — Create the database table

Colordle stores each player's whole stats history as one row.

1. In the sidebar open **SQL Editor** → **New query**.
2. Paste this in and click **Run**:

```sql
create table if not exists public.player_stats (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  -- readable summary columns (easy to browse / sort in the dashboard)
  name           text,
  email          text,
  games_played   int  not null default 0,
  wins           int  not null default 0,
  win_pct        int  not null default 0,
  current_streak int  not null default 0,
  max_streak     int  not null default 0,
  avg_accuracy   int,                       -- null until there's guess data
  -- source of truth used to sync + rebuild each device's history
  days           jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now()
);

-- Lock the table down so each user can only touch their OWN row.
alter table public.player_stats enable row level security;

create policy "own row - read"   on public.player_stats
  for select using (auth.uid() = user_id);
create policy "own row - insert" on public.player_stats
  for insert with check (auth.uid() = user_id);
create policy "own row - update" on public.player_stats
  for update using (auth.uid() = user_id);
```

3. You should see **Success. No rows returned**. To confirm, open **Table Editor**
   in the sidebar — you'll see an empty `player_stats` table with a column per stat.
   (Rows appear only after someone logs in and plays.)

> **Already created the old (2-column) table?** Don't recreate it — just add the
> new columns by running this once in the SQL Editor:
>
> ```sql
> alter table public.player_stats
>   add column if not exists name           text,
>   add column if not exists email          text,
>   add column if not exists games_played   int not null default 0,
>   add column if not exists wins           int not null default 0,
>   add column if not exists win_pct        int not null default 0,
>   add column if not exists current_streak int not null default 0,
>   add column if not exists max_streak     int not null default 0,
>   add column if not exists avg_accuracy   int;
> ```
>
> Existing rows fill in the moment that player next opens the game (it re-syncs).

---

## Step 5 — Configure email login

Email + password works with almost no setup, but two settings matter.

### 5a. Set your site URL (needed for signup links to work)

1. **Authentication** → **URL Configuration**.
2. Set **Site URL** to where the game runs, e.g. `http://localhost:8000`.
3. Under **Redirect URLs**, add the same URL (and later, your real domain).

### 5b. Email confirmation (recommended: turn OFF for local testing)

By default Supabase makes new users confirm their email before they can log in.
That's great for production but annoying while testing on localhost.

1. **Authentication** → **Providers** → **Email**.
2. Toggle **Confirm email** **off** for now → **Save**.
   - Now *Create account* logs you straight in.
   - **Turn this back on before you launch publicly.**

> If you leave confirmation **on**: after signing up, the player gets an email
> with a confirm link (it points at your Site URL). The free built-in mailer is
> rate-limited and can land in spam — for a real launch you'd connect your own
> SMTP (see the next section).

---

## Step 5c — Send from your own address (custom SMTP)

You **don't** need this for the custom email HTML to work — Supabase's built-in
mailer uses your template either way. Set up SMTP when you want real sending:
your own **From** address, no tight rate limit, and inbox (not spam) delivery.

### What you need first: a domain

Real, good-deliverability email needs a domain you control (e.g. `colordle.app`),
so you can send from `hello@yourdomain` and prove you own it.

**No domain yet?** You have options:

- **Easiest — do nothing.** Supabase's built-in mailer already sends your custom
  HTML template (just from a generic address, rate-limited). Fine for dev/testing.
  Skip this whole section until launch. (Or turn **Confirm email off** in Step 5b
  so no email is needed at all while building.)
- **No-domain custom sending.** Providers like **SendGrid** ("Single Sender
  Verification") or **Brevo** let you verify a single email you own (even a Gmail)
  and send from it — no domain required. Deliverability is weaker (no DKIM on your
  own domain) and it sends from your personal address, but it works for low volume.
- **Best — grab a cheap domain** (~$10/yr at **Cloudflare Registrar**, or often
  ~$1–12 first year at **Porkbun** / **Namecheap**), then continue below. Avoid
  "free domain" services — they wreck deliverability.

### 1. Pick an email provider and get SMTP credentials

Any SMTP provider works. **[Resend](https://resend.com)** is the easiest for this
(generous free tier). Steps there:

1. Sign up at resend.com.
2. **Domains → Add Domain** → enter your domain → add the **DNS records** it shows
   (SPF + DKIM, a few TXT/CNAME records) to your domain's DNS, then wait for it to
   verify (minutes to a couple hours).
3. **API Keys → Create API Key** → copy it (starts with `re_`). This is your SMTP
   password.

That gives you these SMTP settings (Resend):

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) — or `587` for STARTTLS |
| Username | `resend` |
| Password | your API key (`re_…`) |

> Other providers (Postmark, SendGrid, Brevo, Amazon SES…) give the same five
> things — host, port, username, password, and a verified From address. Map them
> into the same fields below.

### 2. Enter them in Supabase

1. **Authentication → Emails → SMTP Settings** (a.k.a. "Custom SMTP").
2. Toggle **Enable Custom SMTP** on.
3. Fill in:
   - **Sender email**: an address on your verified domain, e.g. `hello@colordle.app`
   - **Sender name**: `Colordle`
   - **Host**, **Port**, **Username**, **Password**: from the table above.
4. **Save**.

### 3. Lift the email rate limit

The built-in mailer caps auth emails very low. With your own SMTP you can raise it:
**Authentication → Rate Limits → "Rate limit for sending emails"** — bump it to a
sensible number for your traffic.

### 4. Test

Sign up with a fresh email → the confirmation should now arrive **from your
address**, styled with your template, in the inbox. If it doesn't arrive:

| Problem | Fix |
|---|---|
| Nothing arrives | Domain not fully verified in the provider, or wrong host/port. Recheck DNS + credentials. |
| "Sender not allowed" / rejected | The **Sender email** isn't on your verified domain. |
| Lands in spam | Make sure SPF **and** DKIM verified green in the provider; give DNS time to propagate. |
| Auth error on connect | Username/password wrong — for Resend the username is literally `resend` and the password is the `re_…` API key. |

---

## Step 6 — (Optional) "Continue with Google"

Skip this if email/password is enough. Google login needs credentials from Google.

1. **Google side** — [console.cloud.google.com](https://console.cloud.google.com):
   1. Create/select a project.
   2. **APIs & Services → OAuth consent screen**: choose **External**, fill in app
      name + support email, add the `email` and `profile` scopes, and add yourself
      as a **test user**.
   3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
      - Application type: **Web application**
      - **Authorized JavaScript origins**: `http://localhost:8000` (and your domain)
      - **Authorized redirect URIs**:
        `https://<your-project-ref>.supabase.co/auth/v1/callback`
        (find `<your-project-ref>` in your Project URL)
      - Create, then copy the **Client ID** and **Client secret**.
2. **Supabase side** — **Authentication → Providers → Google**:
   - Enable it, paste the **Client ID** and **Client secret**, **Save**.
3. Make sure `http://localhost:8000` is in your **Redirect URLs** (Step 5a).

The "Continue with Google" button will now work.

---

## Step 7 — Test it

1. Run the game (`python3 -m http.server 8000`) and open `http://localhost:8000`.
2. Click the **profile** icon (top-right) → **Create account** with a test email +
   password (6+ chars).
   - Confirmation **off** → you're logged in immediately.
   - Confirmation **on** → confirm via the email link, then **Log in**.
3. The profile panel should show your email and **"✓ Synced to the cloud."**
4. Play and finish a colour, then check **Table Editor → player_stats** in Supabase
   — you'll see a row with readable columns (`name`, `email`, `games_played`,
   `current_streak`, `max_streak`, `avg_accuracy`, …) plus the `days` blob like
   `{"1": {"won": true, "guesses": 3, "pcts": [20,55,100]}}`.
5. Log in on another browser/device to confirm your streak follows you.

---

## Troubleshooting

| Symptom | Likely cause & fix |
|---|---|
| Profile still says "Playing as a guest" | Keys not saved, or page cached. Check `js/supabase-config.js`, then hard-refresh (Cmd/Ctrl+Shift+R). |
| `Invalid API key` | You pasted the wrong key. Use **anon/public**, not service_role. |
| Signup works but login says "Email not confirmed" | Confirmation is on and you haven't clicked the email link. Confirm it, or turn confirmation off (Step 5b). |
| No confirmation email arrives | Free mailer is rate-limited / spam-prone. Check spam, wait a minute, or disable confirmation for testing. |
| `new row violates row-level security policy` | The SQL in Step 4 didn't run, or you're not logged in. Re-run the policies. |
| Stats don't appear in the table | Confirm you're logged in and the table is named exactly `player_stats`. |
| Google button errors | Provider not enabled in Supabase, or redirect URI mismatch — recheck Step 6. |

---

## Step 8 — Colordle Pro entitlements (paid membership + free comps)

This turns **Pro** from a free client-side toggle into a real entitlement the
**server** controls. Once you do this, the Settings "Pro mode" checkbox no longer
grants Pro to everyone — Pro comes from a column on the player's row that only you
(or a payment webhook) can set. **You'll comp your own account in step 8c so you
keep Pro.**

> You need Supabase configured (Steps 1–4) first. This step is just SQL — no
> payment provider yet. Stripe wiring is **Step 9** (optional, add it when you're
> ready to actually charge).

### 8a. Add the entitlement columns

In **SQL Editor → New query**, run:

```sql
alter table public.player_stats
  add column if not exists pro_source              text
    check (pro_source in ('paid','comp','admin')),  -- null = free
  add column if not exists pro_current_period_end   timestamptz; -- paid subs only
```

`pro_source` is the whole entitlement model:

| value | meaning |
|---|---|
| `null` | Free tier |
| `comp` | Comped free (a friend, a giveaway) |
| `admin` | You / staff — free forever |
| `paid` | A live Stripe subscription (valid while `pro_current_period_end` is in the future) |

### 8b. Lock the columns so the browser can never grant itself Pro

RLS lets a user edit their **own** row, which would let them set their own
`pro_source`. This trigger makes those two columns writable **only** with the
service-role key (your admin scripts + the Stripe webhook); any attempt from the
browser is silently ignored. Run it once:

```sql
create or replace function public.guard_entitlement()
returns trigger language plpgsql security definer as $$
declare
  is_service boolean :=
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role';
begin
  if not is_service then
    if tg_op = 'INSERT' then
      new.pro_source := null;
      new.pro_current_period_end := null;
    else -- UPDATE: keep the existing values, ignore any client change
      new.pro_source := old.pro_source;
      new.pro_current_period_end := old.pro_current_period_end;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_entitlement on public.player_stats;
create trigger guard_entitlement
  before insert or update on public.player_stats
  for each row execute function public.guard_entitlement();
```

### 8c. Comp yourself (do this now so you don't lose Pro)

You must have logged into the game at least once (so your row exists). Then run —
using your own login email:

```sql
update public.player_stats
set pro_source = 'admin'
where user_id = (select id from auth.users where email = 'nickpier07@gmail.com');
```

Reload the game while logged in → you're Pro again. To comp a friend, swap the
email (they must have signed up first). To un-comp someone, set `pro_source = null`.

> **Comping before signup?** The row is keyed by the user's auth id, which only
> exists after they create an account. If you want to pre-authorize by email, keep
> a separate `comp_emails` table and check it in the webhook/edge function — not
> needed for the "comp yourself + friends" case.

---

## Step 9 — Charge for Pro with Stripe (optional)

Do this when you actually want to take money. Comps (Step 8) work without it. The
code is already in the repo: `js/billing.js` (client) and two Edge Functions in
`supabase/functions/`. You supply a Stripe account + keys and deploy the functions.

### 9a. Add the Stripe bookkeeping columns

```sql
alter table public.player_stats
  add column if not exists stripe_customer_id      text,
  add column if not exists stripe_subscription_id  text;
create index if not exists player_stats_stripe_customer_idx
  on public.player_stats (stripe_customer_id);
```

### 9b. Create the product in Stripe

1. Sign up at **[stripe.com](https://stripe.com)** (stay in **Test mode** while building — the toggle is top-right).
2. **Product catalog → Add product**: name it *Colordle Pro*, add a **recurring**
   **monthly** price (e.g. $2.99 / month). Save, then copy the **Price ID** (`price_…`).
3. **(Yearly option)** On that same product, **Add another price** → recurring
   **yearly** (e.g. $24.99 / year — price it below 12× the monthly to reward annual).
   Copy this second **Price ID** too. One product, two prices.
4. Grab your **Secret key** (`sk_test_…`) from **Developers → API keys**.

> **Free trial:** you don't set this in the dashboard — the checkout function adds
> a **7-day trial** to every subscription (`trial_period_days`). Stripe still
> collects the card up front and starts charging after the week, and Pro unlocks
> immediately (the webhook treats a trialing sub as active). To change the length,
> set the `STRIPE_TRIAL_DAYS` secret (e.g. `14`); to remove it, set it to `0`. If
> you change it, update the "7-day free trial" wording in `js/settings.js` too.

### 9c. Install the Supabase CLI and deploy the functions

```bash
brew install supabase/tap/supabase          # or see supabase.com/docs/guides/cli
supabase login
supabase link --project-ref dnandkxjjabsclxlxqan   # your project ref (from the URL)

# Secrets the functions read (service-role + SUPABASE_URL are injected automatically).
# STRIPE_PRICE_ID = monthly; STRIPE_PRICE_ID_YEARLY = the annual price (optional).
supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx STRIPE_PRICE_ID=price_monthly_xxx STRIPE_PRICE_ID_YEARLY=price_yearly_xxx

supabase functions deploy create-checkout
supabase functions deploy get-prices          # powers the real prices shown in the UI
supabase functions deploy stripe-webhook --no-verify-jwt   # Stripe isn't a Supabase user
```

### 9d. Wire up the webhook

1. **Stripe → Developers → Webhooks → Add endpoint.**
2. **Endpoint URL:**
   `https://dnandkxjjabsclxlxqan.supabase.co/functions/v1/stripe-webhook`
3. **Events to send:** `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`.
4. Save, copy the **Signing secret** (`whsec_…`), and give it to the function:

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
```

### 9e. Test the full loop (test mode)

1. Log into Colordle, open **Settings → Subscribe** → you land on Stripe Checkout.
2. Pay with the test card **`4242 4242 4242 4242`**, any future expiry / any CVC.
3. Stripe fires `checkout.session.completed` → the webhook sets `pro_source='paid'`.
4. Return to the game and reload → **Pro is active** (Settings shows "Active"; Hard
   Mode / Archive / Practice unlock). Check **Table Editor → player_stats**: your row
   now has `pro_source = paid`, a `stripe_subscription_id`, and a
   `pro_current_period_end` in the future.

> **Race note:** the webhook usually lands within a second, but if you reload the
> instant Stripe redirects back (`?pro=success`) the row may not be written yet —
> another reload resolves it. Add a short "activating…" poll later if you want it
> seamless.

### 9f. Going live

Flip Stripe to **Live mode**, redo 9b–9d with the **live** keys/price/endpoint
(`sk_live_…`, a live `whsec_…`), and re-run `supabase secrets set` with them.
Comps and admin grants are unaffected — they never touch Stripe.

> **Refunds / cancellations** flow automatically: Stripe sends
> `customer.subscription.deleted`, the webhook clears `pro_source` (but only if it
> was `paid` — your own `admin` comp is never wiped). Manage a subscriber from the
> Stripe dashboard.

---

## Step 10 — Let subscribers cancel themselves (Customer Portal)

So players can cancel / update their card / see invoices without emailing you.
Uses Stripe's hosted **Customer Portal**; the code is already in the repo
(`js/billing.js` `openPortal()`, `supabase/functions/create-portal/`, and a
**Manage** link in Settings that appears for paying subscribers).

### 10a. Activate the portal in Stripe

1. Stripe → **Settings → Billing → Customer portal** (in test mode while testing).
2. Under **Subscriptions**, turn **ON** *"Customers can cancel subscriptions"*
   (choose *immediately* or *at end of period* — end-of-period is the usual choice).
   Optionally allow *update quantity* / *switch plans* — not needed for one tier.
3. Optionally enable *"Customers can update payment methods"* and set your
   business name / links. **Save.**

### 10b. Deploy the function

```bash
supabase functions deploy create-portal
```

(No new secrets — it reuses `STRIPE_SECRET_KEY` and the auto-injected Supabase ones.)

### 10c. How it looks

Once a player is on **paid** Pro, **Settings → Colordle Pro** shows **Active** with
a **Manage** link → it opens their portal. A self-serve cancel there fires
`customer.subscription.deleted`, which your **stripe-webhook** already handles:
`pro_source` is cleared and the player drops to free on their next load. Comped /
admin users never see **Manage** (they have no Stripe subscription to manage).

> The **Manage** link only appears for `pro_source = 'paid'`. If you're testing
> with a comped `admin` account you won't see it — subscribe with a test card
> (test mode!) to see the full paid flow.

---

## Security notes

- The **anon key is safe** to ship in the browser — that's its purpose. Access is
  controlled by the **RLS policies**, which restrict every row to its owner.
- **Never** put the **service_role / secret** key in this project or any front-end.
  It lives only in Supabase (as an Edge Function secret) and in scripts you run
  yourself.
- `pro_source` / `pro_current_period_end` are protected by the **`guard_entitlement`
  trigger** (Step 8b): the browser can read them but never write them.
- Colordle only ever reads/writes the logged-in user's own `player_stats` row.
- **Client-side honesty note:** Pro features (Hard Mode, Archive, Practice) run in
  the browser, so a determined user could patch the JS to unlock them. Server
  entitlements stop casual spoofing and drive cross-device state — they're not DRM,
  and for a colour game that's the right trade-off.

## Going live later

When you host the game on a real domain, add that domain to **Authentication →
URL Configuration** (Site URL + Redirect URLs) and turn **email confirmation back
on**. No code changes needed.

---

## Step 11 — Anonymous gameplay analytics (games played)

Cloudflare Web Analytics counts *visits*, not *games*. To count games played —
including anonymous players — the app writes one row per completed game to a
`game_events` table. It's driven by `js/analytics.js` (fire-and-forget; no-ops
when Supabase isn't configured). Run this once in the **SQL Editor**:

```sql
create table if not exists public.game_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  day         integer,
  guesses     integer,
  par         integer,
  mode        text check (mode in ('grid','hard')),
  logged_in   boolean not null default false
);

alter table public.game_events enable row level security;

-- Anyone (signed in OR anonymous) may INSERT a completed-game row. There is
-- deliberately NO select/update/delete policy, so the public anon key can write
-- telemetry but never read or tamper with it. You read it yourself in the
-- dashboard / SQL editor (the service role bypasses RLS).
create policy "anyone can log a game" on public.game_events
  for insert to anon, authenticated
  with check (true);

create index if not exists game_events_created_idx on public.game_events (created_at);
create index if not exists game_events_day_idx     on public.game_events (day);
```

> **Privacy:** no user id, email, or IP is stored — only day / guesses / par /
> mode and a `logged_in` boolean. It's aggregate gameplay telemetry, not personal
> data. (The client never reads this table; it's write-only from the browser.)

### Page views (traffic on the dashboard)

`game_events` counts *games*; to also count *page views* (every load of the site,
player or not — the "Traffic" cards on `stats.html`), add a second write-only
table. It's driven by `logPageView()` in `js/analytics.js`, fired once per load
in `main.js`. Run this once in the **SQL Editor** (before re-running the
`get_game_stats` function below, which reads from it):

```sql
create table if not exists public.page_views (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  path        text,
  user_agent  text,   -- to separate bots from humans on the dashboard
  referrer    text    -- coarse label: 'direct' | 'internal' | external hostname
);

-- If you created page_views before these two columns existed, add them:
alter table public.page_views add column if not exists user_agent text;
alter table public.page_views add column if not exists referrer text;

alter table public.page_views enable row level security;

-- Same contract as game_events: anyone may INSERT, nobody may read via the anon
-- key. You read it through the admin-only get_game_stats() function.
create policy "anyone can log a page view" on public.page_views
  for insert to anon, authenticated
  with check (true);

create index if not exists page_views_created_idx on public.page_views (created_at);
```

> **Privacy:** a timestamp, the URL *path* (e.g. `/`, `/terms.html`), the browser
> user-agent string, and a coarse referrer label (`direct` / `internal` / an
> external hostname like `t.co`) are stored — never the query string (so room
> codes / `?day=` previews aren't kept), never a full referring URL, no user id,
> no IP. The user-agent is what lets the dashboard tell bot traffic from human.
> Until you run this migration, `logPageView()` fails silently and the
> dashboard's Traffic cards show "–".

### Reading it (dashboard → SQL Editor)

```sql
-- total games played
select count(*) as total_games from public.game_events;

-- games + average guesses per day
select day, count(*) as games, round(avg(guesses), 2) as avg_guesses
from public.game_events group by day order by day;

-- anonymous vs logged-in, and grid vs hard mode
select logged_in, mode, count(*) from public.game_events group by logged_in, mode;

-- games in the last 24 hours
select count(*) from public.game_events where created_at > now() - interval '24 hours';
```

Until you run the migration, the app's insert simply fails silently (swallowed by
`analytics.js`) — nothing breaks, you just don't collect events yet.

### The live dashboard (`stats.html`)

`stats.html` is a ready-made dashboard (open it at `/stats.html`) that shows page
views (traffic), total games, per-day trend, guess distribution, grid-vs-hard, and
logged-in-vs-anonymous — refreshing live, no SQL to run. Because `game_events` is **insert-only**, the
dashboard can't read the table with the public key. Instead it calls an **aggregate
function** that returns only summary numbers. Run this once:

```sql
create or replace function public.get_game_stats()
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Admin-only: any account whose app_metadata.role = 'admin' may read stats.
  -- Everyone else gets an error. Grant admin with the SQL below.
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'not authorized';
  end if;

  return (select json_build_object(
    'total_games',   (select count(*) from game_events),
    'games_30m',     (select count(*) from game_events where created_at > now() - interval '30 minutes'),
    'games_24h',     (select count(*) from game_events where created_at > now() - interval '24 hours'),
    'games_7d',      (select count(*) from game_events where created_at > now() - interval '7 days'),
    'avg_guesses',   (select round(avg(guesses), 2) from game_events),
    'distinct_days', (select count(distinct day) from game_events),
    'grid',          (select count(*) from game_events where mode = 'grid'),
    'hard',          (select count(*) from game_events where mode = 'hard'),
    'logged_in',     (select count(*) from game_events where logged_in),
    'anonymous',     (select count(*) from game_events where not logged_in),
    -- Real account holders (people), from player_stats — NOT the per-solve
    -- logged_in flag on game_events (which stays ~0 because players solve as
    -- guests, then sign up via the nudge). account_games = games in their
    -- synced history, which includes guest-played + cross-device days.
    'accounts',       (select count(*) from player_stats),
    'account_games',  (select coalesce(sum(games_played), 0) from player_stats),
    -- Pro membership breakdown (revenue-bearing = 'paid' with a live period;
    -- comp/admin are free grants). Mirrors applyEntitlement() in pro.js. Exact
    -- $ isn't derivable here — the plan/amount isn't stored per member; add it
    -- to the Stripe webhook, or a get-revenue Edge Function, for real dollars.
    'members_paid',  (select count(*) from player_stats
                      where pro_source = 'paid' and pro_current_period_end > now()),
    'members_comp',  (select count(*) from player_stats where pro_source = 'comp'),
    'members_admin', (select count(*) from player_stats where pro_source = 'admin'),
    'page_views_total', (select count(*) from page_views),
    'page_views_30m',   (select count(*) from page_views where created_at > now() - interval '30 minutes'),
    'page_views_24h',   (select count(*) from page_views where created_at > now() - interval '24 hours'),
    'page_views_7d',    (select count(*) from page_views where created_at > now() - interval '7 days'),
    -- Bot vs human by user-agent. Rows logged before the user_agent migration
    -- are NULL and count as neither (so humans + bots can be < total).
    'page_views_bots',   (select count(*) from page_views
                          where user_agent ~* '(bot|crawl|spider|slurp|scan|preview|headless|lighthouse|monitor|python|curl|wget|axios|okhttp|java|go-http|node-fetch|facebookexternalhit|embedly|whatsapp|telegram|discord|slack)'),
    'page_views_humans', (select count(*) from page_views
                          where user_agent is not null and user_agent !~* '(bot|crawl|spider|slurp|scan|preview|headless|lighthouse|monitor|python|curl|wget|axios|okhttp|java|go-http|node-fetch|facebookexternalhit|embedly|whatsapp|telegram|discord|slack)'),
    'referrers', (select coalesce(json_agg(json_build_object('ref', ref, 'n', n) order by n desc), '[]'::json)
                   from (select coalesce(nullif(referrer, ''), 'direct') as ref, count(*) as n
                         from page_views group by 1 order by 2 desc limit 10) s),
    -- Same breakdown but only the last 48h, so a traffic spike can be attributed
    -- to a source (or shown to be mostly referrer-less 'direct') while it's fresh.
    'referrers_48h', (select coalesce(json_agg(json_build_object('ref', ref, 'n', n) order by n desc), '[]'::json)
                       from (select coalesce(nullif(referrer, ''), 'direct') as ref, count(*) as n
                             from page_views where created_at > now() - interval '48 hours'
                             group by 1 order by 2 desc limit 10) s),
    -- Games completed SINCE user-agent tracking began (the first UA-logged view),
    -- so "human play rate" divides games and human views over the same window
    -- instead of all-time games ÷ post-migration views (which exceeds 100%).
    'games_since_tracking', (select count(*) from game_events
                             where created_at >= (select min(created_at) from page_views
                                                  where user_agent is not null)),
    -- Hourly buckets for the last 48h, zero-FILLED (generate_series left join) so
    -- an hour with no games shows as 0 instead of vanishing — the dashboard's
    -- 24h/48h chart views read this; per_day (below) drives the 7d/28d views.
    'per_hour', (select coalesce(json_agg(json_build_object('d', to_char(h, 'MM/DD HH24:00'), 'n', n) order by h), '[]'::json)
                  from (select gs as h, coalesce(c.n, 0) as n
                        from generate_series(date_trunc('hour', now()) - interval '47 hours',
                                             date_trunc('hour', now()), interval '1 hour') gs
                        left join (select date_trunc('hour', created_at) as hh, count(*) as n
                                   from game_events where created_at > now() - interval '48 hours'
                                   group by 1) c on c.hh = gs) s),
    'per_day', (select coalesce(json_agg(json_build_object('d', to_char(d, 'MM/DD'), 'n', n) order by d), '[]'::json)
                 from (select date_trunc('day', created_at)::date as d, count(*) as n
                       from game_events where created_at > now() - interval '28 days'
                       group by 1) s),
    'guess_dist', (select coalesce(json_agg(json_build_object('g', g, 'n', n) order by g), '[]'::json)
                    from (select guesses as g, count(*) as n from game_events
                          where guesses is not null group by 1) s)
  ));
end;
$$;

-- Admin-only: the logged-out anon key can't call it; only signed-in users can,
-- and the email check inside restricts it to you. security definer lets it read
-- past the insert-only RLS to build the summary.
revoke execute on function public.get_game_stats() from anon;
grant execute on function public.get_game_stats() to authenticated;
```

> **Admin-only, two layers:** `stats.html` bounces any non-admin account back to
> the game, and the function above independently rejects any caller without the
> admin role — so even a direct API call returns "not authorized".

### Granting admin

Make any account an admin (yourself, a teammate — as many as you like) by setting
its role. Run in the **SQL Editor**:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'you@example.com';   -- the account to promote
```

`app_metadata` is writable **only** with the service role / SQL editor, never by
the user, so a player can't self-promote. The person must **sign out and back in**
afterwards — the role rides in a fresh JWT. To revoke:

```sql
update auth.users
set raw_app_meta_data = raw_app_meta_data - 'role'
where email = 'them@example.com';
```
