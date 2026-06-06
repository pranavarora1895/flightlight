import { formatCad, formatCadFull } from "./constants";
import type { Deal, Env } from "./types";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function sendViaCloudflare(
  env: Env,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  await env.EMAIL.send({
    from: env.FROM_EMAIL,
    to,
    subject,
    html,
    text: stripHtml(html),
  });
  console.log(`[email] sent via Cloudflare to ${to}: ${subject}`);
}

async function sendViaResend(
  from: string,
  apiKey: string,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend error ${response.status}: ${body}`);
  }

  console.log(`[email] sent via Resend (${from}) to ${to}: ${subject}`);
}

function isResendDomainError(message: string): boolean {
  return (
    message.includes("domain is not verified") ||
    message.includes("verify a domain")
  );
}

function isResendRecipientError(message: string): boolean {
  return message.includes("only send testing emails to your own email");
}

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  try {
    await sendViaCloudflare(env, to, subject, html);
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[email] Cloudflare send failed: ${message}`);
  }

  try {
    await sendViaResend(env.FROM_EMAIL, env.RESEND_API_KEY, to, subject, html);
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[email] Resend send failed: ${message}`);
    throw new EmailDeliveryError(formatEmailError(message));
  }
}

function formatEmailError(message: string): string {
  if (isResendDomainError(message) || isResendRecipientError(message)) {
    return (
      "Email is not set up yet. Add and verify pranavarora.dev at resend.com/domains " +
      "(copy the DNS records into Cloudflare), then sign-in links will work for thearanavarora@gmail.com and family."
    );
  }
  return "Could not send email. Please try again shortly.";
}

export async function sendMagicLinkEmail(
  env: Env,
  to: string,
  verifyUrl: string,
): Promise<void> {
  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 32px;">
  <div style="max-width: 480px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 32px;">
    <h1 style="margin: 0 0 8px; font-size: 22px;">YYT → DEL Flight Tracker</h1>
    <p style="color: #94a3b8; margin: 0 0 24px;">Sign in to view prices and manage your alert range.</p>
    <a href="${verifyUrl}" style="display: inline-block; background: #22c55e; color: #052e16; text-decoration: none; font-weight: 600; padding: 12px 24px; border-radius: 8px;">Sign in</a>
    <p style="color: #64748b; font-size: 13px; margin-top: 24px;">This link expires in 15 minutes. If you didn't request this, ignore this email.</p>
  </div>
</body>
</html>`;

  await sendEmail(env, to, "Sign in to YYT→DEL Flight Tracker", html);
}

function routeLabel(d: Deal): string {
  const origin = d.origin ?? "YYT";
  const dest = d.destination ?? "DEL";
  if (origin === d.hub) return `${origin} → ${dest}`;
  return `${origin} → ${d.hub} → ${dest}`;
}

function bookLinksCell(d: Deal): string {
  const links: string[] = [];
  const intlUrl =
    d.intlBookingUrl ??
    `https://www.google.com/travel/flights/search?q=${encodeURIComponent(`Flights from ${d.hub} to ${d.destination} on ${d.depDate} returning ${d.retDate}`)}&curr=CAD`;
  links.push(`<a href="${escapeHtml(intlUrl)}" style="color:#22c55e;">International</a>`);

  if (d.origin !== d.hub) {
    if (d.domesticOutboundBookingUrl) {
      links.push(`<a href="${escapeHtml(d.domesticOutboundBookingUrl)}" style="color:#22c55e;">Outbound</a>`);
    }
    if (d.domesticReturnBookingUrl) {
      links.push(`<a href="${escapeHtml(d.domesticReturnBookingUrl)}" style="color:#22c55e;">Return</a>`);
    }
  }

  return links.join(" · ");
}

function dealsTableHtml(deals: Deal[]): string {
  const rows = deals
    .map(
      (d) => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #334155;">${routeLabel(d)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #334155;">${d.depDate}</td>
      <td style="padding: 8px; border-bottom: 1px solid #334155;">${d.retDate}</td>
      <td style="padding: 8px; border-bottom: 1px solid #334155; font-weight: 600;">${formatCadFull(d.totalPrice)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #334155;">${formatCadFull(d.intlPrice)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #334155;">${formatCadFull(d.domesticPrice)}${d.domesticEstimated ? " (est.)" : ""}</td>
      <td style="padding: 8px; border-bottom: 1px solid #334155;">${escapeHtml(d.airline)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #334155;">${bookLinksCell(d)}</td>
    </tr>`,
    )
    .join("");

  return `
  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
    <thead>
      <tr style="background: #1e293b; text-align: left;">
        <th style="padding: 8px;">Route</th>
        <th style="padding: 8px;">Depart</th>
        <th style="padding: 8px;">Return</th>
        <th style="padding: 8px;">Total</th>
        <th style="padding: 8px;">Intl</th>
        <th style="padding: 8px;">Domestic</th>
        <th style="padding: 8px;">Airline</th>
        <th style="padding: 8px;">Book</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendDealAlertEmail(
  env: Env,
  to: string,
  deals: Deal[],
): Promise<void> {
  if (deals.length === 0) return;

  const sorted = [...deals].sort((a, b) => a.totalPrice - b.totalPrice);
  const best = sorted[0];
  const hasEstimate = sorted.some((d) => d.domesticEstimated);

  const subject = `✈️ ${routeLabel(best)} from ${formatCadFull(best.totalPrice)} — departs ${best.depDate}`;
  const footer = hasEstimate
    ? "<p style='color:#64748b;font-size:13px;margin-top:16px;'>Note: domestic leg price may be estimated when live data was unavailable.</p>"
    : "";

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px;">
  <div style="max-width: 720px; margin: 0 auto;">
    <h1 style="font-size: 20px; margin-bottom: 8px;">Deals in your alert range</h1>
    <p style="color: #94a3b8; margin-top: 0;">Found ${sorted.length} option${sorted.length === 1 ? "" : "s"} matching your settings.</p>
    ${dealsTableHtml(sorted)}
    ${footer}
    <p style="color: #64748b; font-size: 13px; margin-top: 24px;"><a href="${env.APP_URL}/dashboard" style="color:#22c55e;">View dashboard</a></p>
  </div>
</body>
</html>`;

  await sendEmail(env, to, subject, html);
}
