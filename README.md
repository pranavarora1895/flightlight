# Flightlight

Family flight price tracker on Cloudflare Workers. Tracks multi-leg routes (e.g. YYT → YYZ → DEL), stores price history, and emails alerts when fares fall in each member's budget.

**Live app:** [flightlight.pranavarora.dev](https://flightlight.pranavarora.dev)

## Features

- Per-user routes — origin, destination, connection hubs, and alert range
- Two-stage pricing — international leg + domestic connections
- Skyscanner-style dashboard with route visualization and Google Flights booking links
- Invite-code signup with magic-link email login
- Daily cron with tiered search (free/paid Serpapi plans)

## Stack

- Cloudflare Workers + Hono (TypeScript)
- D1 — users, sessions, magic links, route settings
- KV — 30-day price history, domestic cache, alert dedup
- Serpapi Google Flights API
- Resend — magic links and deal alerts

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

Open `http://localhost:8787`, sign in with your email and invite code.

## Secrets

Set locally in `.dev.vars` (never commit this file) or in production with `wrangler secret put`:

| Secret | Purpose |
|--------|---------|
| `SERPAPI_KEY` | Serpapi Google Flights API key |
| `RESEND_API_KEY` | Resend API key |
| `INVITE_CODE` | Shared family signup code |
| `SESSION_SECRET` | Random string for signing session cookies |

```bash
npx wrangler secret put SERPAPI_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put INVITE_CODE
npx wrangler secret put SESSION_SECRET
```

Verify `flights@pranavarora.dev` as a sender in [Resend](https://resend.com/domains) for domain `pranavarora.dev`.

## Search tiers

Set `SEARCH_TIER` in [wrangler.jsonc](wrangler.jsonc):

| Tier | Serpapi plan | Behavior |
|------|--------------|----------|
| `free` (default) | Free 250/mo | 4 departure dates, 1 hub per run (rotates), every 3 days, cached domestic legs |
| `paid` | $25/mo 1000 searches | 5 departure dates, all hubs, every 2 days, live domestic legs |

After upgrading Serpapi, change `"SEARCH_TIER": "paid"` and redeploy.

## Deploy

```bash
npm run db:migrate
npm run deploy
```

Production URL: **https://flightlight.pranavarora.dev**

## Routes

| Route | Description |
|-------|-------------|
| `GET /` | Login page |
| `POST /auth/login` | Request magic link |
| `GET /auth/verify` | Complete sign-in |
| `GET /dashboard` | Price history + route & alert settings |
| `POST /settings` | Save route and alert range |
| `GET /run` | Manual tracker run (plain-text log) |
| `GET /health` | Health check |

## Family onboarding

1. Deploy the Worker and set secrets.
2. Share the app URL and `INVITE_CODE` with family.
3. Each person signs in with their email — alerts go to that address.
4. Each person sets their route and min/max alert range on the dashboard.

## Pricing logic

For each hub and departure date:

1. International round-trip: `{hub} → destination`
2. Domestic one-way: `{origin} → {hub}` (outbound)
3. Domestic one-way: `{hub} → {origin}` (return)
4. **Total** = international + both domestic legs

## Logs

```bash
npm run tail
```
