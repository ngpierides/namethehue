# Name the Hue 🎨

A daily colour game. You're given a colour **name** and a grid of swatches — find
the one that matches. A fresh puzzle every day, the same for everyone.

- **Left-click / tap** a swatch to guess it. You get a **closeness score (%)**
  based on how similar it looks to the answer (ΔE2000, a perceptual
  colour-distance formula). 100% is the answer.
- **Right-click / long-press** a swatch to rule it out — it darkens with a red ✕
  (Minesweeper-style). Tap again to un-flag. This is free.
- **Unlimited guesses — there is no fail state** (the "Globle" model). The goal is
  to solve at or under each day's **par** (2–6), derived from how tricky that
  day's colour is.

## Run it

It's a **zero-build static site** — plain HTML/CSS + ES modules, no bundler, no
`package.json`. Any static file server works:

```bash
python3 -m http.server 8000
```

Then open **http://localhost:8000**. (Or `npx serve` if you prefer Node.)

> ### ⚠️ Bump the version after editing any JS or CSS
> Modules load through an **import map** in `index.html` that appends `?v=N`, and
> the stylesheet link carries the same `?v=N`. Browsers cache hard by URL, so a
> change won't take effect until you bump the version everywhere:
> ```bash
> sed -i '' 's/?v=53/?v=54/g' index.html
> ```
> If something "isn't updating," this is almost always why (or hard-refresh with
> Cmd/Ctrl+Shift+R).

## How the daily puzzle works

Everything is derived from a **day number** (days since the `epoch` date in
`js/config.js`) via seeded RNG, so the same day produces the identical target
colour and grid for every player — no game server needed. The target is picked
from `data/colors.json` by walking a fixed shuffled deck, so colours don't repeat
for ~949 days. Days run 1..today only (never the future); past days live in the
**Archive** (a Pro perk).

### When does the day roll over?

One setting: `timeZone` in `js/config.js`.

- **`'local'` (default)** — each player rolls over at *their own* local midnight,
  like NYT Wordle. Any two players on the same calendar date get the same colour.
- **A fixed IANA zone** (e.g. `'America/New_York'`) — one shared global cutoff;
  everyone flips at that zone's midnight. Better if you later add a leaderboard.

## Choosing colours

- **Automatic (default):** each day gets a colour from `data/colors.json` (949
  names, from the public-domain [XKCD colour survey](https://xkcd.com/color/rgb/)).
  Add to the master pool by appending `{ "name": "…", "hex": "#rrggbb" }`.
- **Hand-pick a day:** add an entry to `data/puzzles.json` keyed by day number:
  ```json
  { "42": { "name": "deep teal", "hex": "#00555a" } }
  ```

## Pro, Hard Mode & multiplayer

- **Name the Hue Pro** (Settings) unlocks **Hard Mode** (mix the colour yourself
  with a 2D picker instead of choosing a swatch), the past-games **Archive**, and
  unlimited **Practice**. Pro is granted server-side via Stripe when cloud sync is
  configured, or a free local toggle when it isn't.
- **Play a friend** — an online head-to-head mode (grid race or Hard-Mode mix),
  first to 5 rounds wins. No login required; the room runs over an ephemeral
  Supabase realtime channel.
- **Settings** — theme (System / Light / Dark), reduce motion, and reset progress.

## Results & stats

When a game ends (or you tap 📊), a results screen shows your Played count, average
guesses, current & max streak, average accuracy, guess distribution, a countdown
to the next colour, and a **Share** button (a Wordle-style result with closeness
"heat" squares). Stats are your own history in this browser, stored under
`localStorage['colordle:stats']` — and synced to the cloud if you're logged in.

## Cloud login & sync (optional — Supabase)

The **profile** button lets players log in (email + password) so their stats and
streak follow them across devices. It's **entirely optional**: with no keys set in
`js/supabase-config.js`, the game runs fine and saves everything locally.

**➡️ Full walkthrough — accounts, SQL, RLS, Stripe payments, troubleshooting:
[SUPABASE_SETUP.md](SUPABASE_SETUP.md)**

Short version: create a project at [supabase.com](https://supabase.com), paste your
**Project URL** + **anon/public key** into `js/supabase-config.js`, run the table +
Row-Level-Security SQL from `SUPABASE_SETUP.md`, and reload. On login the cloud
`days` blob is **merged** with the device's (a better result always wins), so
playing on two devices never loses progress.

## Project layout

```
colourgame/
├── index.html              # Markup + the import map (single source of ?v= versions)
├── css/styles.css          # All styling (light/dark via CSS tokens)
├── js/
│   ├── config.js           # Tuning: grid size, distCap, distractors, epoch, timeZone
│   ├── rng.js              # Seeded PRNG → deterministic daily puzzles
│   ├── color.js            # Colour maths: hex↔RGB↔Lab, ΔE2000, closeness %
│   ├── puzzle.js           # Day number → target + grid + difficulty/par
│   ├── game.js             # Rules engine (Game + Hard-Mode HardGame), DOM-free
│   ├── ui.js               # Grid/guess DOM (UI) + Hard-Mode board (HardUI)
│   ├── colorfield.js       # The reusable 2D colour picker (Hard Mode + MP)
│   ├── storage.js          # Per-day board persistence (local only)
│   ├── stats.js            # History blob + cloud-sync seams
│   ├── results.js          # Stats / share modal
│   ├── settings.js         # Settings modal (appearance, Pro, data)
│   ├── archive.js          # Past-games Archive modal (Pro)
│   ├── pro.js              # Pro entitlement seam (local toggle or server-granted)
│   ├── auth.js             # Optional Supabase login + cloud stat sync
│   ├── billing.js          # Stripe checkout / portal (client side)
│   ├── pricing.js          # Live Pro prices from Stripe
│   ├── profile.js          # Login / account modal
│   ├── proupsell.js        # Shared "Get Pro" upsell popup
│   ├── multiplayer.js      # Online "play a friend" mode
│   ├── toast.js            # Toast notifications
│   ├── supabase-config.js  # ← your Supabase keys (safe to ship; anon key only)
│   └── main.js             # Bootstrap + the single show(day) re-render path
├── data/
│   ├── colors.json         # Master colour list (949 names, public domain / CC0)
│   └── puzzles.json         # Optional per-day overrides
├── supabase/functions/     # Edge Functions for Stripe (checkout, portal, webhook, prices)
├── email-templates/        # Signup confirmation email (paste into Supabase)
├── privacy.html / terms.html
├── SUPABASE_SETUP.md       # Cloud + payments setup guide
└── CLAUDE.md               # Architecture notes (deepest reference)
```

## Tips

- **Preview any day** (Pro): add `?day=N` to the URL, e.g. `…/?day=42`.
- Tune difficulty in `js/config.js`: `hardDistractors` (near-miss swatches),
  `closenessMaxDeltaE` (scoring harshness), `distCap`, and grid size.

## Credits

Colour names come from the [XKCD colour survey](https://xkcd.com/color/rgb/),
released into the public domain (CC0).
