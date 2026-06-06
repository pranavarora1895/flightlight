# Flightlight

Family flight price tracker on Cloudflare Workers. Tracks multi-leg routes (e.g. YYT → YYZ → DEL), stores price history, and emails alerts when fares fall in each member's budget.

**Live app:** [flightlight.pranavarora.dev](https://flightlight.pranavarora.dev)

## Features

- Per-user routes — origin and destination only (hubs picked automatically), plus max stops, alert range, and automatic checks on/off
- Multi-leg pricing — international round-trip + domestic connections, optimized as a combined itinerary
- Skyscanner-style dashboard with route visualization and Google Flights booking links
- Invite-code signup for new users; returning users sign in with email only
- Magic-link email login (Resend)
- Daily cron with tiered search (free/paid Serpapi plans); manual **Run now** resets the schedule
- Email alerts when total price falls within a user's min/max range

## Stack

| Component | Purpose |
|-----------|---------|
| Cloudflare Workers + Hono | HTTP API and UI |
| D1 | Users, sessions, magic links, per-user route settings |
| KV | 30-day price history, domestic cache, hub/return rotation state, run lock |
| Serpapi Google Flights API | Live fare data |
| Resend | Magic-link login + deal alert emails |
| Cron (`0 14 * * *` UTC) | Daily wake-up; actual search runs only when the interval gate allows |

## Quick start

```bash
git clone https://github.com/pranavarora1895/flightlight.git
cd flightlight
npm install
npm run types
cp .dev.vars.example .dev.vars
# Fill in secrets in .dev.vars
npm run db:migrate
npm run dev
```

Open `http://localhost:8787`. New users need the family invite code; returning users only need their email.

## Secrets

Set locally in `.dev.vars` (never commit this file) or in production:

```bash
npx wrangler secret bulk .dev.vars
```

| Secret | Purpose |
|--------|---------|
| `SERPAPI_KEY` | Serpapi Google Flights API key |
| `RESEND_API_KEY` | Resend API key |
| `INVITE_CODE` | Shared family signup code |
| `SESSION_SECRET` | Random string for signing session cookies |

Verify `flights@pranavarora.dev` as a sender in [Resend](https://resend.com/domains) for domain `pranavarora.dev`.

**Note:** If you rename the Worker in `wrangler.jsonc`, secrets do not carry over — run `wrangler secret bulk .dev.vars` again on the new worker name.

## Deploy

```bash
npm run db:migrate
npm run deploy
```

Production URL: **https://flightlight.pranavarora.dev**

## HTTP routes

| Route | Description |
|-------|-------------|
| `GET /` | Login page |
| `POST /auth/login` | Request magic link |
| `GET /auth/verify` | Complete sign-in |
| `GET /dashboard` | Price history + trip settings |
| `POST /settings` | Save route, max stops, and alert range |
| `GET /run` | Manual price check (redirects back to dashboard) |
| `GET /health` | Health check |

## User settings

Each signed-in user configures their own trip on the dashboard:

| Setting | Description |
|---------|-------------|
| **From / To** | 3-letter IATA airport codes (e.g. YYT, DEL). Connection hubs are chosen automatically. |
| **Depart from / by** | Outbound window; the tracker samples 4–5 dates evenly across it each run. |
| **Return from / by** | Return window; 3 dates are sampled and rotated one per run. |
| **Min days away** | Trip buffer — return must be at least this many days after departure (default **28**). |
| **Max stops (total trip)** | Layover limit across domestic + international legs combined (0–6; default 2). `0` = nonstop only. |
| **Automatic price checks** | When enabled (default), your route is included in scheduled cron runs. Uncheck to pause cron for your account only. **Run now** still works. |
| **Check every (days)** | How often automatic searches run for your route (default **3** days, minimum **2**). Cron wakes daily but only searches you when your interval has elapsed. |
| **Min / max price** | Alert range in CAD |

## Search algorithm

Flightlight does **not** pick fares at random. Each run searches a fixed set of departure dates per user, respects your **max stops** setting across the whole trip, and saves the cheapest valid option per date.

### Primary: door-to-door search

For each departure date, the tracker first searches **round-trip `{origin} ↔ {destination}`** with your full `max_stops` budget. Google Flights can return multi-stop itineraries on one ticket — e.g. **YYT → YYZ → ZRH → DEL** when you allow 4 stops.

The outbound airport chain is extracted from Serpapi flight segments and shown on the dashboard (`routePath`).

### Fallback: split tickets via connection hubs

If the direct search returns nothing (or a split fare is cheaper), the tracker tries **separate domestic + international legs** via auto-selected hubs (e.g. YYZ and YUL for YYT):

```
{origin} ──domestic──► {hub} ──international RT──► {destination}
                ▲                              │
                └──────── domestic return ───────┘
```

A combinatorial optimizer (`src/optimizer.ts`) tries up to 5 fares per Serpapi response and picks the cheapest combination within your stop budget.

For each departure date, the **cheaper of direct vs split** is saved.

Records are keyed:

```
{runDate}:{userId}:{origin}:{via}:{destination}:{depDate}:{retDate}
```

`via` is the middle airport(s) in the path (e.g. `YYZ-ZRH`), so different routings do not overwrite each other.

### Search grid (what gets checked each run)

| Dimension | Free tier | Paid tier |
|-----------|-----------|-----------|
| Departure dates | 4 samples from your depart window | 5 samples |
| Return date | 1 per run, rotates across 3 samples from your return window | same |
| Trip buffer | Per-user `trip_min_days` (default 28) | same |
| Direct search | 1 RT call per departure date | same |
| Split fallback hubs | Auto (e.g. YYZ + YUL for YYT→DEL); 1 per run on free tier (rotates) | all auto hubs each run |
| Users | all active users | all active users |

### Stop counting

- **Direct ticket:** layovers on the full round-trip option (outbound + return segments).
- **Split ticket:** sum of stops on international + domestic outbound + domestic return.
- **User filter:** only itineraries where total stops ≤ `max_stops` are saved.
- **Serpapi pre-filter:** for 3+ stops, the API is asked for “any” stops and results are filtered client-side.

### Serpapi calls per departure date

| Strategy | Calls |
|----------|-------|
| Direct | 1 round-trip `{origin} ↔ {destination}` |
| Split (when `origin !== hub`) | 1 RT `{hub} ↔ {destination}` + 2 OW domestic legs |
| Split (when `origin === hub`) | 1 RT only |

Calls are spaced by **600 ms** (`API_DELAY_MS`) to avoid rate limits.

### Domestic caching (free tier)

On the free tier, domestic legs are cached in KV for **7 days** per route **and date**:

```
domestic:{from}:{to}:{date}
```

Paid tier always fetches live domestic fares (`alwaysLiveDomestic: true`).

### Fallback estimates

When Serpapi returns no domestic results, known CAD estimates are used (marked **est** on the dashboard):

| Route | Fallback |
|-------|----------|
| YYT ↔ YYZ | $380 |
| YYT ↔ YUL | $440 |
| Other | $400 |

Fallback legs are treated as 0 stops and `estimated: true`.

### Scheduling and run lock

| Mechanism | Behavior |
|-----------|----------|
| **Cron** | Fires daily at 14:00 UTC |
| **Per-user interval** | Each user sets **check every N days** (min 2). Last check stored in `tracker:lastRunAt:{userId}` (KV). |
| **Per-user pause** | Users with **Automatic price checks** off are skipped by cron; manual **Run now** still includes all active users. |
| **Manual Run now** | Runs immediately for all active users and **resets** each user's `lastRunAt` when complete |
| **Run lock** | `tracker:runLock` in KV prevents cron and manual runs from overlapping (15 min TTL) |

Only **one** Cloudflare Worker (`flightlight`) should exist with this cron — duplicate workers mean duplicate schedules.

### Serpapi monthly quota

The app tracks Serpapi calls in KV (`serpapi:usage:YYYY-MM`):

| Tier | Monthly limit |
|------|----------------|
| Free | 250 |
| Paid | 1000 |

When the limit is reached:

- Scheduled and manual runs are **blocked** until the next calendar month
- The dashboard shows a **popup** and an **API used / limit** badge
- Usage is incremented after each successful Serpapi HTTP response

**Note:** This is self-tracked by Flightlight. Serpapi’s own dashboard is the source of truth if the counts diverge.

### State rotation (KV)

| Key | Purpose |
|-----|---------|
| `tracker:lastRunAt` | ISO timestamp of last completed run |
| `tracker:returnDateIndex:{userId}` | Cycles through each user's return samples each run |
| `tracker:hubIndex:{userId}` | Cycles through a user's hubs on free tier |
| `tracker:runLock` | Prevents concurrent runs |
| `alerts:{userId}:{dealKey}` | 24 h dedup so the same deal is not emailed twice |

### Alerts

After each run, for each user:

1. Filter saved deals where `alert_min ≤ totalPrice ≤ alert_max`
2. Skip deals already alerted in the last 24 hours
3. Send a Resend email with a deals table and booking links

## Search tiers

Set `SEARCH_TIER` in [wrangler.jsonc](wrangler.jsonc):

| | Free (default) | Paid |
|--|----------------|------|
| Serpapi plan | ~250 searches/mo | ~1000 searches/mo ($25/mo) |
| Departure dates | 4 | 5 |
| Hubs per run | 1 (rotates) | all |
| Run interval | every 48 h | every 48 h |
| Domestic legs | cached 7 days | always live |
| ~API calls per run per user | ~9 (1 hub × 4 dates × ~2 calls + intl) | ~20 |

After upgrading Serpapi, set `"SEARCH_TIER": "paid"` and redeploy.

### Trip dates (per user on dashboard)

Each user sets on the dashboard:

- **Depart from / Depart by** — outbound window (evenly sampled each run)
- **Return from / Return by** — return window (3 samples, one per run rotated)
- **Min days away** — buffer between departure and return (default 28)

Defaults match the original YYT→DEL trip (Nov 18 – Dec 2 depart, Dec 30 – Jan 13 return).

User-configurable date ranges on the dashboard are not implemented yet.

## Limitations and future improvements

| Limitation | Why | Possible improvement |
|------------|-----|----------------------|
| ±N day date flexibility around each sample | Would multiply searches | Single sampled date per window slot |
| Free tier checks one hub per run | ~50% fewer API calls | Check all hubs every run (paid behavior) |
| Separate tickets per leg | Serpapi/Google Flights models legs independently | Multi-city API if supported |
| Up to 5 fares per API response | Balance optimality vs. combinatorics | Increase `OPTIONS_PER_SEARCH` |
| No ±N day date flexibility | Would multiply searches | "Flexible dates" window per departure |
| Greedy across grid cells | Each hub×date saved separately | Cross-cell "best trip" summary card |

## Project layout

```
src/
  index.ts      # Hono routes
  tracker.ts    # Search orchestration, scheduling, KV writes
  optimizer.ts  # Combinatorial itinerary optimizer
  serpapi.ts    # Serpapi Google Flights client
  db.ts         # D1 queries
  auth.ts       # Magic link + session cookies
  email.ts      # Resend alerts
  html.ts       # Dashboard UI
  constants.ts  # Dates, tiers, fallbacks
  airports.ts   # IATA labels and validation
migrations/     # D1 schema
```

## Family onboarding

1. Deploy the Worker and set secrets (`wrangler secret bulk .dev.vars`).
2. Share the app URL and `INVITE_CODE` with family.
3. Each person signs in with their email — alerts go to that address.
4. Each person sets their route, max stops, and alert range on the dashboard.

## Logs

```bash
npm run tail
```

Serpapi calls log option counts and best price; the tracker logs combined itinerary totals and stop breakdowns.
