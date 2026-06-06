import { airportCity, airportLabel, POPULAR_AIRPORTS } from "./airports";
import { formatCad, formatCadFull, getSearchProfile, parseSearchTier } from "./constants";
import { userRoute } from "./db";
import {
  buildUserTripSchedule,
  userTripDates,
} from "./dates";
import type {
  GlobalScheduleStatus,
  UserScheduleRow,
} from "./schedule";
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
    html {
      overflow-x: clip;
      -webkit-text-size-adjust: 100%;
    }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      overflow-x: clip;
      width: 100%;
    }
    a { color: var(--accent-light); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .container {
      width: 100%;
      max-width: 960px;
      min-width: 0;
      margin: 0 auto;
      padding: 16px 12px 40px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
      min-width: 0;
      max-width: 100%;
    }
    .header {
      display: flex;
      flex-direction: column;
      flex-wrap: wrap;
      gap: 12px;
      align-items: stretch;
      justify-content: space-between;
      margin-bottom: 16px;
      min-width: 0;
    }
    h1 { margin: 0; font-size: 1.5rem; font-weight: 700; }
    h2 { margin: 0 0 14px; font-size: 1rem; font-weight: 600; color: var(--text); }
    .route-title {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
      min-width: 0;
    }
    .badge {
      display: inline-block;
      padding: 5px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--muted);
      max-width: 100%;
      line-height: 1.35;
      word-break: break-word;
    }
    .trip-summary {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      margin-bottom: 16px;
      min-width: 0;
      width: 100%;
    }
    .trip-summary-item {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
      min-width: 0;
    }
    .trip-summary-label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .trip-summary-value {
      display: block;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.4;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .sample-schedule {
      padding: 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
    }
    .sample-schedule-title {
      margin: 0 0 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    .sample-schedule-row {
      margin-top: 10px;
      min-width: 0;
    }
    .sample-label {
      display: block;
      color: var(--muted);
      font-weight: 600;
      font-size: 12px;
      margin-bottom: 6px;
    }
    .date-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
    }
    .date-chip {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      max-width: 100%;
      word-break: break-word;
    }
    .badge.blue { background: #1e3a5f; color: #93c5fd; border-color: #2563eb; }
    .muted { color: var(--muted); font-size: 14px; line-height: 1.5; }
    .error { color: #f87171; margin: 8px 0 0; font-size: 14px; }
    .success { color: #86efac; margin: 0; font-size: 14px; }
    label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    input, select {
      width: 100%;
      max-width: 100%;
      min-width: 0;
      padding: 11px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      font-size: 16px;
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
    .stack { display: grid; gap: 14px; min-width: 0; }
    .row { display: grid; grid-template-columns: 1fr; gap: 12px; min-width: 0; }
    .row > div { min-width: 0; max-width: 100%; }
    .row-3 { display: grid; grid-template-columns: 1fr; gap: 12px; }
    input[type="date"] {
      display: block;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      -webkit-appearance: none;
      appearance: none;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: stretch;
      width: 100%;
      min-width: 0;
    }
    .toolbar form { flex: 1; min-width: 0; margin: 0; }
    .toolbar .btn,
    .toolbar button {
      flex: 1 1 0;
      min-width: 0;
      text-align: center;
    }
    @media (min-width: 640px) {
      .container { padding: 20px 16px 48px; }
      .card { padding: 20px; }
      .row { grid-template-columns: 1fr 1fr; }
      .row-3 { grid-template-columns: 1fr 1fr 1fr; }
      .trip-summary { grid-template-columns: repeat(3, 1fr); gap: 10px; }
      .header {
        flex-direction: row;
        align-items: flex-start;
      }
      .toolbar { width: auto; }
      .toolbar .btn,
      .toolbar button { flex: 0 1 auto; }
    }
    .login-wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .login-card { width: 100%; max-width: 420px; }
    .badge.warn { background: rgba(251, 191, 36, 0.15); color: #fcd34d; border-color: #b45309; }
    .badge.danger { background: rgba(248, 113, 113, 0.15); color: #fca5a5; border-color: #b91c1c; }
    .check-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface-2);
    }
    .check-row input { width: auto; margin-top: 3px; }
    .check-row label { margin: 0; text-transform: none; letter-spacing: 0; font-size: 14px; color: var(--text); font-weight: 500; }
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(2, 6, 23, 0.78);
      display: grid;
      place-items: center;
      padding: 20px;
      z-index: 1000;
    }
    .modal-card {
      width: 100%;
      max-width: 420px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 24px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
    }
    .modal-card h2 { margin: 0 0 12px; font-size: 1.15rem; }
    .modal-card.modal-wide {
      max-width: min(640px, 100%);
      max-height: 85vh;
      overflow-y: auto;
    }
    .modal-close { margin-top: 18px; width: 100%; }
    .modal-overlay.schedule-modal { display: none; }
    .modal-overlay.schedule-modal.open { display: grid; }
    .schedule-stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin: 16px 0;
      min-width: 0;
    }
    .schedule-stat {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      min-width: 0;
    }
    .schedule-stat-label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .schedule-stat-value {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.35;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .schedule-list {
      display: grid;
      gap: 10px;
      margin-top: 12px;
      min-width: 0;
    }
    .schedule-user {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      background: var(--surface-2);
      min-width: 0;
    }
    .schedule-user.is-you { border-color: var(--accent); }
    .schedule-user.due { border-color: var(--deal); }
    .schedule-user-head {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      min-width: 0;
    }
    .schedule-user-email {
      font-weight: 700;
      font-size: 14px;
      word-break: break-word;
      min-width: 0;
    }
    .schedule-user-route {
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .schedule-user-meta {
      font-size: 12px;
      color: var(--muted);
      line-height: 1.45;
      word-break: break-word;
    }
    .schedule-user-meta strong { color: var(--text); }
    .status-pill {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .status-pill.due { background: var(--deal-bg); color: #6ee7b7; border: 1px solid var(--deal); }
    .status-pill.wait { background: var(--surface); color: var(--muted); border: 1px solid var(--border); }
    .status-pill.paused { background: rgba(148, 163, 184, 0.12); color: var(--muted); border: 1px solid var(--border); }
    .btn-run-now {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 20px;
      border-radius: 10px;
      border: none;
      background: linear-gradient(135deg, #0770e3 0%, #2563eb 55%, #3b9eff 100%);
      color: #fff;
      font-weight: 700;
      font-size: 15px;
      text-decoration: none;
      box-shadow: 0 4px 16px rgba(7, 112, 227, 0.4);
      transition: transform 0.15s, box-shadow 0.15s, filter 0.15s;
      flex: 1 1 auto;
      min-width: 0;
    }
    .btn-run-now:hover {
      text-decoration: none;
      filter: brightness(1.08);
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(7, 112, 227, 0.5);
    }
    .btn-run-now svg {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }
    .btn-user-cron-pause,
    .btn-user-cron-resume {
      width: 100%;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid var(--border);
    }
    .btn-user-cron-pause {
      background: rgba(127, 29, 29, 0.25);
      border-color: #b91c1c;
      color: #fecaca;
    }
    .btn-user-cron-pause:hover { background: rgba(153, 27, 27, 0.4); }
    .btn-user-cron-resume {
      background: rgba(5, 150, 105, 0.15);
      border-color: var(--deal);
      color: #6ee7b7;
    }
    .btn-user-cron-resume:hover { background: rgba(5, 150, 105, 0.28); }
    @media (max-width: 640px) {
      .schedule-stats { grid-template-columns: 1fr; }
    }

    /* Skyscanner-style flight cards */
    .flights { display: grid; gap: 12px; }
    .flight-card {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      align-items: start;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      transition: border-color 0.15s;
      min-width: 0;
      max-width: 100%;
    }
    .flight-info { min-width: 0; max-width: 100%; }
    .flight-card.deal {
      border-color: var(--deal);
      background: var(--deal-bg);
      box-shadow: inset 4px 0 0 var(--deal);
    }
    @media (min-width: 640px) {
      .flight-card {
        grid-template-columns: 1fr auto;
        align-items: center;
        padding: 18px 20px;
      }
    }
    .route-visual {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px 4px;
      font-weight: 700;
      font-size: 1rem;
      margin-bottom: 10px;
      min-width: 0;
      max-width: 100%;
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
      font-size: 12px;
      font-weight: 400;
      padding: 0 1px;
      flex-shrink: 1;
    }
    .route-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 20px;
      font-size: 13px;
      color: var(--muted);
    }
    .route-meta strong { color: var(--text); font-weight: 600; }
    .price-block {
      text-align: left;
      min-width: 0;
      max-width: 100%;
    }
    @media (min-width: 640px) {
      .price-block { text-align: right; }
    }
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
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      max-width: 100%;
      word-break: break-word;
      text-align: center;
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

function formatDateRangeShort(start: string, end: string): string {
  if (start === end) return formatDateShort(start);
  const startDate = new Date(start + "T12:00:00");
  const endDate = new Date(end + "T12:00:00");
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const startLabel = startDate.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endLabel = endDate.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startLabel} – ${endLabel}`;
}

function formatDateChip(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function dateChipsHtml(dates: string[]): string {
  return `<div class="date-chips">${dates
    .map(
      (iso) =>
        `<span class="date-chip">${escapeHtml(formatDateChip(iso))}</span>`,
    )
    .join("")}</div>`;
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
  const isSplitTicket =
    r.domesticPrice > 0 ||
    Boolean(r.domesticOutboundBookingUrl || r.domesticReturnBookingUrl);

  if (!isSplitTicket) {
    const bookUrl =
      r.intlBookingUrl ?? googleFlightsUrl(origin, dest, r.depDate, r.retDate);
    links.push(
      `<a class="btn-book primary" href="${escapeHtml(bookUrl)}" target="_blank" rel="noopener noreferrer">Book ${escapeHtml(origin)} ↔ ${escapeHtml(dest)}</a>`,
    );
    return `<div class="book-links">${links.join("")}</div>`;
  }

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
  const path =
    record.routePath && record.routePath.length >= 2
      ? record.routePath
      : [record.origin ?? "YYT", record.destination ?? "DEL"];

  return path
    .map((code, index) => {
      const isMiddle = index > 0 && index < path.length - 1;
      const airport = `<span class="airport-code${isMiddle ? " hub" : ""}">${escapeHtml(code)}</span>`;
      const line =
        index < path.length - 1
          ? '<span class="route-line">—— ✈ ——</span>'
          : "";
      return airport + line;
    })
    .join("");
}

function viaLabel(record: KVRecord): string {
  const path = record.routePath;
  if (path && path.length > 2) {
    return path
      .slice(1, -1)
      .map((code) => `${airportCity(code)} (${code})`)
      .join(" → ");
  }
  return `${airportCity(record.hub)} (${record.hub})`;
}

function flightCards(records: KVRecord[], alertMax: number, route: { origin: string; destination: string }): string {
  if (records.length === 0) {
    return `<div class="empty-state">
      <p>No flights tracked yet for ${escapeHtml(route.origin)} → ${escapeHtml(route.destination)}.</p>
      <p class="hint" style="margin-top:8px;">Save your route below, then click <strong>Run now</strong> to check prices immediately. That resets the automatic schedule — only one check runs at a time.</p>
    </div>`;
  }

  return `<div class="flights">${records
    .map((r) => {
      const isDeal = r.totalPrice <= alertMax;
      const originCity = airportCity(r.origin ?? "YYT");
      const destCity = airportCity(r.destination ?? "DEL");
      const isSplitTicket = r.domesticPrice > 0;
      const priceBreakdown = isSplitTicket
        ? `<span>International ${formatCad(r.intlPrice)}</span>
            <span>Connection ${formatCad(r.domesticPrice)}${r.domesticEstimated ? '<span class="est">est</span>' : ""}</span>`
        : `<span>Round trip ${formatCad(r.totalPrice)}</span>`;

      return `<article class="flight-card${isDeal ? " deal" : ""}">
        <div class="flight-info">
          ${isDeal ? '<div class="deal-tag">In your budget</div>' : ""}
          <div class="route-visual">${routeVisual(r)}</div>
          <div class="route-meta">
            <span><strong>${formatDateShort(r.depDate)}</strong> · Depart ${escapeHtml(originCity)}</span>
            <span><strong>${formatDateShort(r.retDate)}</strong> · Return to ${escapeHtml(originCity)}</span>
            <span>Via <strong>${escapeHtml(viaLabel(r))}</strong></span>
            ${typeof r.totalStops === "number" ? `<span>${formatStopsLabel(r.totalStops)} total</span>` : ""}
          </div>
          <div class="airline-name">${escapeHtml(r.airline)}</div>
          ${bookLinksHtml(r)}
        </div>
        <div class="price-block">
          <div class="price-total">${formatCad(r.totalPrice)}</div>
          <div class="price-breakdown">
            ${priceBreakdown}
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
      <h1>✈️ Flightlight</h1>
      <p class="muted">Enter your email for a sign-in link. First-time users also need the family invite code.</p>
      <form method="post" action="/auth/login" class="stack" style="margin-top:20px;">
        <div>
          <label for="email">Email</label>
          <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com">
        </div>
        <div>
          <label for="invite_code">Invite code <span class="muted" style="font-weight:400;">(new users only)</span></label>
          <input id="invite_code" name="invite_code" type="password" autocomplete="off" placeholder="Leave blank if you've signed in before">
        </div>
        <button type="submit">Send sign-in link</button>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
        ${message ? `<p class="success">${escapeHtml(message)}</p>` : ""}
      </form>
    </div>
  </div>`;
  return layout("Sign in — Flightlight", body);
}

function formatScheduleTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function scheduleUserStatusPill(row: UserScheduleRow): string {
  if (!row.autoCheck) {
    return '<span class="status-pill paused">Paused</span>';
  }
  if (row.dueAtNextCron) {
    return '<span class="status-pill due">Due next cron</span>';
  }
  return '<span class="status-pill wait">Scheduled</span>';
}

const PLANE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;

function runNowButtonHtml(): string {
  return `<a class="btn-run-now" href="/run">${PLANE_ICON_SVG}<span>Run now</span></a>`;
}

function scheduleUserToggleForm(row: UserScheduleRow): string {
  const enable = row.autoCheck ? "0" : "1";
  const label = row.autoCheck
    ? "Pause automatic checks"
    : "Resume automatic checks";
  const btnClass = row.autoCheck
    ? "btn-user-cron-pause"
    : "btn-user-cron-resume";
  const confirmAttr = row.autoCheck
    ? ` onsubmit="return confirm('Pause automatic checks for ${escapeHtml(row.email)}? They can still use Run now.')"`
    : "";

  return `<form method="post" action="/cron/user/toggle" style="margin-top:10px"${confirmAttr}>
      <input type="hidden" name="user_id" value="${escapeHtml(row.userId)}">
      <input type="hidden" name="enable" value="${enable}">
      <button type="submit" class="${btnClass}">${escapeHtml(label)}</button>
    </form>`;
}

function scheduleUserCard(
  row: UserScheduleRow,
  currentUserId: string,
): string {
  const classes = [
    "schedule-user",
    row.userId === currentUserId ? "is-you" : "",
    row.dueAtNextCron && row.autoCheck ? "due" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const nextLabel = !row.autoCheck
    ? "Automatic checks off"
    : row.nextCheckAt
      ? formatScheduleTime(row.nextCheckAt)
      : "—";

  const lastLabel = row.lastRunAt
    ? formatScheduleTime(row.lastRunAt)
    : "Never";

  const youTag =
    row.userId === currentUserId
      ? ' <span class="muted" style="font-weight:600;">(you)</span>'
      : "";

  return `<article class="${classes}">
    <div class="schedule-user-head">
      <span class="schedule-user-email">${escapeHtml(row.email)}${youTag}</span>
      ${scheduleUserStatusPill(row)}
    </div>
    <div class="schedule-user-route">${escapeHtml(row.origin)} → ${escapeHtml(row.destination)} · every ${row.checkIntervalDays} day${row.checkIntervalDays === 1 ? "" : "s"}</div>
    <div class="schedule-user-meta">
      <div>Last check: <strong>${escapeHtml(lastLabel)}</strong></div>
      <div>Next check: <strong>${escapeHtml(nextLabel)}</strong></div>
    </div>
    ${scheduleUserToggleForm(row)}
  </article>`;
}

function scheduleModalHtml(
  schedule: GlobalScheduleStatus,
  currentUserId: string,
): string {
  const lastCron = schedule.lastCronAt
    ? formatScheduleTime(schedule.lastCronAt)
    : "Not recorded yet";
  const lastSummary = schedule.lastCronSummary
    ? schedule.lastCronSummary.skipped
      ? `Skipped — ${schedule.lastCronSummary.skipReason ?? "no reason logged"}`
      : `${schedule.lastCronSummary.usersChecked} route(s), ${schedule.lastCronSummary.searchCount} API search(es)`
    : "—";

  const userCards =
    schedule.users.length > 0
      ? schedule.users
          .map((row) => scheduleUserCard(row, currentUserId))
          .join("")
      : '<p class="muted">No family members signed up yet.</p>';

  return `
  <div class="modal-overlay schedule-modal" id="schedule-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-title" onclick="if(event.target===this)this.classList.remove('open')">
    <div class="modal-card modal-wide">
      <h2 id="schedule-title">Family check schedule</h2>
      <p class="muted" style="margin:0;">The worker cron runs daily for the family. Each person is only searched when their interval has passed. Anyone can pause or resume automatic checks per person below.</p>

      <div class="schedule-stats">
        <div class="schedule-stat">
          <span class="schedule-stat-label">Global cron</span>
          <span class="schedule-stat-value">${escapeHtml(schedule.cronLabel)}</span>
        </div>
        <div class="schedule-stat">
          <span class="schedule-stat-label">Next cron run</span>
          <span class="schedule-stat-value">${escapeHtml(formatScheduleTime(schedule.nextCronAt))}</span>
        </div>
        <div class="schedule-stat">
          <span class="schedule-stat-label">Last cron run</span>
          <span class="schedule-stat-value">${escapeHtml(lastCron)}</span>
        </div>
        <div class="schedule-stat">
          <span class="schedule-stat-label">Last cron result</span>
          <span class="schedule-stat-value">${escapeHtml(lastSummary)}</span>
        </div>
        <div class="schedule-stat">
          <span class="schedule-stat-label">Auto-tracking</span>
          <span class="schedule-stat-value">${schedule.scheduledUsers} of ${schedule.activeUsers} member${schedule.activeUsers === 1 ? "" : "s"}</span>
        </div>
        <div class="schedule-stat">
          <span class="schedule-stat-label">Due next cron</span>
          <span class="schedule-stat-value">${schedule.dueAtNextCron} route${schedule.dueAtNextCron === 1 ? "" : "s"}</span>
        </div>
      </div>

      <h3 style="margin:0 0 8px;font-size:0.95rem;">Everyone</h3>
      <div class="schedule-list">${userCards}</div>

      <button type="button" class="modal-close" onclick="document.getElementById('schedule-modal')?.classList.remove('open')">Close</button>
    </div>
  </div>`;
}

function quotaPopupHtml(ctx: DashboardContext): string {
  if (!ctx.showQuotaPopup) return "";

  return `
  <div class="modal-overlay" id="quota-modal" role="dialog" aria-modal="true" aria-labelledby="quota-title">
    <div class="modal-card">
      <h2 id="quota-title">Serpapi limit reached</h2>
      <p class="muted">Flight price searches are exhausted for this month (${ctx.quotaUsed} / ${ctx.quotaLimit} used). Automatic and manual checks are paused until the calendar month resets.</p>
      <button type="button" class="modal-close" onclick="document.getElementById('quota-modal').remove()">OK</button>
    </div>
  </div>`;
}

export function dashboardPage(ctx: DashboardContext, env: Env): string {
  const profile = getSearchProfile(parseSearchTier(env.SEARCH_TIER));
  const route = userRoute(ctx.user);
  const trip = userTripDates(ctx.user);
  const schedule = buildUserTripSchedule(ctx.user, profile);
  const routeLabel = `${route.origin} → ${route.destination}`;
  const quotaBadgeClass = ctx.quotaExhausted
    ? "danger"
    : ctx.quotaUsed / ctx.quotaLimit >= 0.8
      ? "warn"
      : "";
  const nextLabel = ctx.user.auto_check
    ? ctx.nextRunEstimate
      ? escapeHtml(formatNextRun(ctx.nextRunEstimate))
      : "—"
    : "Automatic checks off";

  const body = `
  ${quotaPopupHtml(ctx)}
  ${scheduleModalHtml(ctx.globalSchedule, ctx.user.id)}
  <div class="container">
    <div class="header">
      <div>
        <div class="route-title">✈️ ${escapeHtml(route.origin)} → ${escapeHtml(route.destination)}</div>
        <p class="muted" style="margin-top:4px;">${escapeHtml(airportLabel(route.origin))} to ${escapeHtml(airportLabel(route.destination))}</p>
        <p class="muted" style="margin-top:2px;">Signed in as ${escapeHtml(ctx.user.email)}</p>
      </div>
      <div class="toolbar">
        ${runNowButtonHtml()}
        <button type="button" class="btn secondary" onclick="document.getElementById('schedule-modal')?.classList.add('open')">Family schedule</button>
        <form method="post" action="/auth/logout" style="margin:0;">
          <button type="submit" class="secondary">Sign out</button>
        </form>
      </div>
    </div>

    <div class="trip-summary">
      <div class="trip-summary-item">
        <span class="trip-summary-label">Depart</span>
        <span class="trip-summary-value">${escapeHtml(formatDateRangeShort(trip.departStart, trip.departEnd))}</span>
      </div>
      <div class="trip-summary-item">
        <span class="trip-summary-label">Return</span>
        <span class="trip-summary-value">${escapeHtml(formatDateRangeShort(trip.returnStart, trip.returnEnd))}</span>
      </div>
      <div class="trip-summary-item">
        <span class="trip-summary-label">Trip buffer</span>
        <span class="trip-summary-value">${trip.tripMinDays} day${trip.tripMinDays === 1 ? "" : "s"} min</span>
      </div>
    </div>

    <div class="badges">
      <span class="badge blue">${escapeHtml(ctx.tierLabel)}</span>
      <span class="badge">Budget ${formatCadFull(ctx.user.alert_min)} – ${formatCadFull(ctx.user.alert_max)}</span>
      <span class="badge">Max ${ctx.user.max_stops} stop${ctx.user.max_stops === 1 ? "" : "s"}</span>
      ${ctx.user.auto_check ? `<span class="badge">Every ${ctx.user.check_interval_days} day${ctx.user.check_interval_days === 1 ? "" : "s"}</span>` : ""}
      <span class="badge">Last: ${ctx.lastRunAt ? escapeHtml(new Date(ctx.lastRunAt).toLocaleString()) : "Never"}</span>
      <span class="badge">Next: ${nextLabel}</span>
      <span class="badge ${quotaBadgeClass}">API ${ctx.quotaUsed}/${ctx.quotaLimit}</span>
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
        <p class="hint" style="margin-top:-4px;">We search door-to-door for your route and respect your max stops (e.g. YYT → YYZ → ZRH → DEL on one ticket when available).</p>
        <div class="row">
          <div>
            <label for="depart_start">Depart from</label>
            <input id="depart_start" name="depart_start" type="date" value="${escapeHtml(trip.departStart)}" required>
          </div>
          <div>
            <label for="depart_end">Depart by</label>
            <input id="depart_end" name="depart_end" type="date" value="${escapeHtml(trip.departEnd)}" required>
          </div>
        </div>
        <div class="row">
          <div>
            <label for="return_start">Return from</label>
            <input id="return_start" name="return_start" type="date" value="${escapeHtml(trip.returnStart)}" required>
          </div>
          <div>
            <label for="return_end">Return by</label>
            <input id="return_end" name="return_end" type="date" value="${escapeHtml(trip.returnEnd)}" required>
          </div>
        </div>
        <div>
          <label for="trip_min_days">Min days away (trip buffer)</label>
          <input id="trip_min_days" name="trip_min_days" type="number" min="1" max="90" value="${trip.tripMinDays}" required>
          <p class="hint">Minimum days between departure and return (e.g. 28 = ~4 weeks at destination). Return must be at least this many days after each departure we search.</p>
        </div>
        <div class="sample-schedule">
          <p class="sample-schedule-title">Dates checked each run</p>
          <div class="sample-schedule-row">
            <span class="sample-label">Departures (${profile.departureDateCount})</span>
            ${dateChipsHtml(schedule.departureDates)}
          </div>
          <div class="sample-schedule-row">
            <span class="sample-label">Returns (rotates)</span>
            ${dateChipsHtml(schedule.returnDates)}
          </div>
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
        <div>
          <label for="max_stops">Max stops (total trip)</label>
          <input id="max_stops" name="max_stops" type="number" min="0" max="6" value="${ctx.user.max_stops}" required>
          <p class="hint">Counts layovers on domestic + international legs combined. 0 = nonstop only.</p>
        </div>
        <div class="check-row">
          <input id="auto_check" name="auto_check" type="checkbox" value="1"${ctx.user.auto_check ? " checked" : ""}>
          <label for="auto_check">Automatic price checks<br><span class="muted" style="font-weight:400;">Uncheck to pause scheduled searches for your route. You can still use Run now.</span></label>
        </div>
        <div>
          <label for="check_interval_days">Check every (days)</label>
          <input id="check_interval_days" name="check_interval_days" type="number" min="2" max="30" value="${ctx.user.check_interval_days}" required>
          <p class="hint">Minimum 2 days between automatic checks. Cron runs daily but only searches your route when this interval has passed.</p>
        </div>
        <button type="submit">Save my trip</button>
      </form>
    </div>

    <div class="card">
      <h2>Flights · ${escapeHtml(routeLabel)}</h2>
      <p class="muted" style="margin-bottom:16px;">Sorted cheapest first for ${escapeHtml(route.origin)} → ${escapeHtml(route.destination)}. Green cards are within your max budget (${formatCadFull(ctx.user.alert_max)}).</p>
      ${flightCards(ctx.records, ctx.user.alert_max, route)}
      <p class="hint" style="margin-top:16px;">Total price includes your full trip (connection + international where applicable). <span class="est">est</span> = estimated when live data unavailable (${escapeHtml(profile.label)}).</p>
    </div>
  </div>`;

  return layout(`Flights ${routeLabel} — Flightlight`, body);
}

function formatStopsLabel(stops: number): string {
  if (stops === 0) return "Nonstop";
  if (stops === 1) return "1 stop";
  return `${stops} stops`;
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
