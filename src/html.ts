import { airportCity, airportLabel, POPULAR_AIRPORTS } from "./airports";
import { formatCad, formatCadFull, getSearchProfile, parseSearchTier } from "./constants";
import { userRoute } from "./db";
import type { DashboardContext, Env, KVRecord } from "./types";

function layout(title: string, body: string): string {
  const airportOptions = POPULAR_AIRPORTS.map(
    (a) => `<option value="${a.code}">${a.city} (${a.code})</option>`,
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #0a1628;
      --surface: #111827;
      --surface-2: #1a2332;
      --border: #2d3748;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --accent: #0770e3;
      --accent-light: #3b9eff;
      --deal: #059669;
      --deal-bg: rgba(5, 150, 105, 0.12);
      --warn: #fbbf24;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    a { color: var(--accent-light); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .container { max-width: 960px; margin: 0 auto; padding: 20px 16px 48px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .header {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    h1 { margin: 0; font-size: 1.5rem; font-weight: 700; }
    h2 { margin: 0 0 14px; font-size: 1rem; font-weight: 600; color: var(--text); }
    .route-title {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .badges { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .badge {
      display: inline-block;
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--muted);
    }
    .badge.blue { background: #1e3a5f; color: #93c5fd; border-color: #2563eb; }
    .muted { color: var(--muted); font-size: 14px; line-height: 1.5; }
    .error { color: #f87171; margin: 8px 0 0; font-size: 14px; }
    .success { color: #86efac; margin: 0; font-size: 14px; }
    label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    input, select {
      width: 100%;
      padding: 11px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      font-size: 15px;
    }
    input:focus, select:focus { outline: 2px solid var(--accent); border-color: var(--accent); }
    button, .btn {
      display: inline-block;
      padding: 11px 18px;
      border-radius: 8px;
      border: none;
      background: var(--accent);
      color: #fff;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      font-size: 14px;
    }
    button:hover, .btn:hover { background: var(--accent-light); }
    button.secondary, .btn.secondary {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
    }
    .stack { display: grid; gap: 14px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
    @media (max-width: 640px) { .row, .row-3 { grid-template-columns: 1fr; } }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .login-wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .login-card { width: 100%; max-width: 420px; }

    /* Skyscanner-style flight cards */
    .flights { display: grid; gap: 12px; }
    .flight-card {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: center;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px 20px;
      transition: border-color 0.15s;
    }
    .flight-card.deal {
      border-color: var(--deal);
      background: var(--deal-bg);
      box-shadow: inset 4px 0 0 var(--deal);
    }
    @media (max-width: 640px) {
      .flight-card { grid-template-columns: 1fr; }
    }
    .route-visual {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px 4px;
      font-weight: 700;
      font-size: 1.05rem;
      margin-bottom: 10px;
    }
    .airport-code {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 15px;
    }
    .airport-code.hub { border-color: var(--accent); color: var(--accent-light); }
    .route-line {
      color: var(--muted);
      font-size: 13px;
      font-weight: 400;
      padding: 0 2px;
    }
    .route-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 20px;
      font-size: 13px;
      color: var(--muted);
    }
    .route-meta strong { color: var(--text); font-weight: 600; }
    .price-block { text-align: right; min-width: 140px; }
    @media (max-width: 640px) { .price-block { text-align: left; } }
    .price-total {
      font-size: 1.75rem;
      font-weight: 800;
      color: var(--text);
      line-height: 1.1;
    }
    .flight-card.deal .price-total { color: #6ee7b7; }
    .price-breakdown {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    .airline-name {
      margin-top: 8px;
      font-size: 13px;
      color: var(--muted);
    }
    .book-links {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .btn-book {
      display: inline-block;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
    }
    .btn-book:hover { background: var(--surface-2); text-decoration: none; }
    .btn-book.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .btn-book.primary:hover { background: var(--accent-light); }
    .est {
      display: inline-block;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 999px;
      background: #422006;
      color: #fde68a;
      font-weight: 600;
      margin-left: 4px;
      vertical-align: middle;
    }
    .deal-tag {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      background: var(--deal);
      color: #fff;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--muted);
    }
    .hint { font-size: 12px; color: var(--muted); margin-top: 4px; }
    datalist { display: none; }
  </style>
  <datalist id="airports">${airportOptions}</datalist>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateShort(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function googleFlightsUrl(
  from: string,
  to: string,
  dep: string,
  ret?: string,
): string {
  const q = ret
    ? `Flights from ${from} to ${to} on ${dep} returning ${ret}`
    : `Flights from ${from} to ${to} on ${dep}`;
  return `https://www.google.com/travel/flights/search?q=${encodeURIComponent(q)}&curr=CAD`;
}

function bookLinksHtml(r: KVRecord): string {
  const origin = r.origin ?? "YYT";
  const dest = r.destination ?? "DEL";
  const links: string[] = [];

  const intlUrl =
    r.intlBookingUrl ??
    googleFlightsUrl(r.hub, dest, r.depDate, r.retDate);
  links.push(
    `<a class="btn-book primary" href="${escapeHtml(intlUrl)}" target="_blank" rel="noopener noreferrer">Book ${escapeHtml(r.hub)} ↔ ${escapeHtml(dest)}</a>`,
  );

  if (origin !== r.hub) {
    const outUrl =
      r.domesticOutboundBookingUrl ??
      googleFlightsUrl(origin, r.hub, r.depDate);
    const retUrl =
      r.domesticReturnBookingUrl ??
      googleFlightsUrl(r.hub, origin, r.retDate);
    links.push(
      `<a class="btn-book" href="${escapeHtml(outUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(origin)} → ${escapeHtml(r.hub)}</a>`,
      `<a class="btn-book" href="${escapeHtml(retUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.hub)} → ${escapeHtml(origin)}</a>`,
    );
  }

  return `<div class="book-links">${links.join("")}</div>`;
}

function routeVisual(record: KVRecord): string {
  const origin = record.origin ?? "YYT";
  const dest = record.destination ?? "DEL";
  const hub = record.hub;

  if (origin === hub) {
    return `
      <span class="airport-code">${escapeHtml(origin)}</span>
      <span class="route-line">—— ✈ ——</span>
      <span class="airport-code">${escapeHtml(dest)}</span>`;
  }

  return `
    <span class="airport-code">${escapeHtml(origin)}</span>
    <span class="route-line">—— ✈ ——</span>
    <span class="airport-code hub">${escapeHtml(hub)}</span>
    <span class="route-line">—— ✈ ——</span>
    <span class="airport-code">${escapeHtml(dest)}</span>`;
}

function flightCards(records: KVRecord[], alertMax: number, route: { origin: string; destination: string }): string {
  if (records.length === 0) {
    return `<div class="empty-state">
      <p>No flights tracked yet for ${escapeHtml(route.origin)} → ${escapeHtml(route.destination)}.</p>
      <p class="hint" style="margin-top:8px;">Save your route below, then click <strong>Run now</strong>.</p>
    </div>`;
  }

  return `<div class="flights">${records
    .map((r) => {
      const isDeal = r.totalPrice <= alertMax;
      const originCity = airportCity(r.origin ?? "YYT");
      const destCity = airportCity(r.destination ?? "DEL");
      const hubCity = airportCity(r.hub);

      return `<article class="flight-card${isDeal ? " deal" : ""}">
        <div class="flight-info">
          ${isDeal ? '<div class="deal-tag">In your budget</div>' : ""}
          <div class="route-visual">${routeVisual(r)}</div>
          <div class="route-meta">
            <span><strong>${formatDateShort(r.depDate)}</strong> · Depart ${escapeHtml(originCity)}</span>
            <span><strong>${formatDateShort(r.retDate)}</strong> · Return to ${escapeHtml(originCity)}</span>
            <span>Via <strong>${escapeHtml(hubCity)} (${escapeHtml(r.hub)})</strong></span>
          </div>
          <div class="airline-name">${escapeHtml(r.airline)}</div>
          ${bookLinksHtml(r)}
        </div>
        <div class="price-block">
          <div class="price-total">${formatCad(r.totalPrice)}</div>
          <div class="price-breakdown">
            <span>International ${formatCad(r.intlPrice)}</span>
            <span>Connection ${formatCad(r.domesticPrice)}${r.domesticEstimated ? '<span class="est">est</span>' : ""}</span>
          </div>
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

export function loginPage(error?: string, message?: string): string {
  const body = `
  <div class="login-wrap">
    <div class="card login-card">
      <h1>✈️ Flight Tracker</h1>
      <p class="muted">Track prices for your route. Sign in with your email and invite code.</p>
      <form method="post" action="/auth/login" class="stack" style="margin-top:20px;">
        <div>
          <label for="email">Email</label>
          <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com">
        </div>
        <div>
          <label for="invite_code">Invite code</label>
          <input id="invite_code" name="invite_code" type="password" required autocomplete="off" placeholder="Family invite code">
        </div>
        <button type="submit">Send sign-in link</button>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
        ${message ? `<p class="success">${escapeHtml(message)}</p>` : ""}
      </form>
    </div>
  </div>`;
  return layout("Sign in — Flight Tracker", body);
}

export function dashboardPage(ctx: DashboardContext, env: Env): string {
  const profile = getSearchProfile(parseSearchTier(env.SEARCH_TIER));
  const route = userRoute(ctx.user);
  const routeLabel = `${route.origin} → ${route.destination}`;

  const body = `
  <div class="container">
    <div class="header">
      <div>
        <div class="route-title">✈️ ${escapeHtml(route.origin)} → ${escapeHtml(route.destination)}</div>
        <p class="muted" style="margin-top:4px;">${escapeHtml(airportLabel(route.origin))} to ${escapeHtml(airportLabel(route.destination))}</p>
        <p class="muted" style="margin-top:2px;">Signed in as ${escapeHtml(ctx.user.email)}</p>
      </div>
      <div class="toolbar">
        <a class="btn secondary" href="/run">Run now</a>
        <form method="post" action="/auth/logout" style="margin:0;">
          <button type="submit" class="secondary">Sign out</button>
        </form>
      </div>
    </div>

    <div class="badges">
      <span class="badge blue">${escapeHtml(ctx.tierLabel)}</span>
      <span class="badge">Budget ${formatCadFull(ctx.user.alert_min)} – ${formatCadFull(ctx.user.alert_max)}</span>
      <span class="badge">Last check: ${ctx.lastRunAt ? escapeHtml(new Date(ctx.lastRunAt).toLocaleString()) : "Never"}</span>
      <span class="badge">Next: ${ctx.nextRunEstimate ? escapeHtml(formatNextRun(ctx.nextRunEstimate)) : "—"}</span>
    </div>

    ${ctx.message ? `<div class="card"><p class="success">${escapeHtml(ctx.message)}</p></div>` : ""}
    ${ctx.error ? `<div class="card"><p class="error">${escapeHtml(ctx.error)}</p></div>` : ""}

    <div class="card">
      <h2>Your trip</h2>
      <p class="muted" style="margin-bottom:16px;">Settings are saved to your email — each family member can track a different route.</p>
      <form method="post" action="/settings" class="stack">
        <div class="row">
          <div>
            <label for="origin">From (airport code)</label>
            <input id="origin" name="origin" list="airports" value="${escapeHtml(route.origin)}" required maxlength="3" pattern="[A-Za-z]{3}" placeholder="YYT">
            <p class="hint">e.g. YYT St. John's, YYZ Toronto</p>
          </div>
          <div>
            <label for="destination">To (airport code)</label>
            <input id="destination" name="destination" list="airports" value="${escapeHtml(route.destination)}" required maxlength="3" pattern="[A-Za-z]{3}" placeholder="DEL">
            <p class="hint">e.g. DEL Delhi, LHR London</p>
          </div>
        </div>
        <div>
          <label for="hubs">Connection cities (comma-separated)</label>
          <input id="hubs" name="hubs" value="${escapeHtml(ctx.user.hubs)}" required placeholder="YYZ,YUL">
          <p class="hint">International flights go via these hubs. Example: YYT → YYZ → DEL</p>
        </div>
        <div class="row">
          <div>
            <label for="alert_min">Min price (CAD)</label>
            <input id="alert_min" name="alert_min" type="number" min="500" max="10000" value="${ctx.user.alert_min}" required>
          </div>
          <div>
            <label for="alert_max">Max price (CAD)</label>
            <input id="alert_max" name="alert_max" type="number" min="500" max="10000" value="${ctx.user.alert_max}" required>
          </div>
        </div>
        <button type="submit">Save my trip</button>
      </form>
    </div>

    <div class="card">
      <h2>Flights · ${escapeHtml(routeLabel)}</h2>
      <p class="muted" style="margin-bottom:16px;">Sorted cheapest first. Green cards are within your max budget (${formatCadFull(ctx.user.alert_max)}).</p>
      ${flightCards(ctx.records, ctx.user.alert_max, route)}
      <p class="hint" style="margin-top:16px;">Prices combine international (${route.origin}→hub→${route.destination}) + connection legs. <span class="est">est</span> = estimated when live data unavailable (${escapeHtml(profile.label)}).</p>
    </div>
  </div>`;

  return layout(`Flights ${routeLabel} — Flight Tracker`, body);
}

function formatNextRun(value: string): string {
  if (value === "Pending first run") return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function plainTextLog(lines: string[]): string {
  return lines.join("\n");
}
