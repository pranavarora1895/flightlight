import {
  MAGIC_LINK_MINUTES,
  SESSION_COOKIE,
  SESSION_DAYS,
} from "./constants";
import {
  consumeMagicLink,
  createMagicLink,
  createSession,
  deleteSession,
  getUserBySessionToken,
  upsertUser,
} from "./db";
import { sendMagicLinkEmail } from "./email";
import type { Env, User } from "./types";

async function hmacSign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function verifySignature(
  secret: string,
  value: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSign(secret, value);
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  );
}

export function buildSessionCookie(token: string, secure: boolean): string {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export async function getSessionUser(
  env: Env,
  request: Request,
): Promise<User | null> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;

  const [token, signature] = raw.split(".");
  if (!token || !signature) return null;

  const valid = await verifySignature(env.SESSION_SECRET, token, signature);
  if (!valid) return null;

  return getUserBySessionToken(env.DB, token);
}

export async function createSignedSession(
  env: Env,
  userId: string,
  secure: boolean,
): Promise<string> {
  const token = await createSession(env.DB, userId, SESSION_DAYS);
  const signature = await hmacSign(env.SESSION_SECRET, token);
  return buildSessionCookie(`${token}.${signature}`, secure);
}

export async function loginWithInvite(
  env: Env,
  email: string,
  inviteCode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!email.trim() || !email.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }

  if (inviteCode.trim() !== env.INVITE_CODE) {
    return { ok: false, error: "Invalid invite code." };
  }

  const user = await upsertUser(env.DB, email);
  const token = await createMagicLink(env.DB, user.email, MAGIC_LINK_MINUTES);
  const verifyUrl = `${env.APP_URL}/auth/verify?token=${encodeURIComponent(token)}`;

  await sendMagicLinkEmail(env, user.email, verifyUrl);
  return { ok: true };
}

export async function verifyMagicLink(
  env: Env,
  token: string,
  secure: boolean,
): Promise<{ cookie: string; user: User } | null> {
  const email = await consumeMagicLink(env.DB, token);
  if (!email) return null;

  const user = await upsertUser(env.DB, email);
  const cookie = await createSignedSession(env, user.id, secure);
  return { cookie, user };
}

export async function logout(env: Env, request: Request): Promise<void> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return;

  const [token] = raw.split(".");
  if (token) {
    await deleteSession(env.DB, token);
  }
}
