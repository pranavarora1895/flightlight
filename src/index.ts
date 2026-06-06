import { Hono } from "hono";
import {
  formatHubList,
  isValidIata,
  normalizeIata,
  parseHubList,
} from "./airports";
import {
  ALERT_MAX_BOUND,
  ALERT_MIN_BOUND,
  getSearchProfile,
  parseSearchTier,
} from "./constants";
import {
  clearSessionCookie,
  getSessionUser,
  loginWithInvite,
  logout,
  verifyMagicLink,
} from "./auth";
import { updateUserSettings } from "./db";
import { EmailDeliveryError } from "./email";
import { dashboardPage, loginPage } from "./html";
import { getNextRunEstimate, listPriceRecords, runTracker } from "./tracker";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

function isSecure(request: Request): boolean {
  const url = new URL(request.url);
  return url.protocol === "https:" || url.hostname === "localhost";
}

app.get("/health", (c) => c.text("OK"));

app.get("/", async (c) => {
  const user = await getSessionUser(c.env, c.req.raw);
  if (user) return c.redirect("/dashboard", 302);

  const message = c.req.query("message");
  const error = c.req.query("error");
  return c.html(loginPage(error ?? undefined, message ?? undefined));
});

app.post("/auth/login", async (c) => {
  const form = await c.req.parseBody();
  const email = String(form.email ?? "");
  const inviteCode = String(form.invite_code ?? "");

  try {
    const result = await loginWithInvite(c.env, email, inviteCode);
    if (!result.ok) {
      return c.html(loginPage(result.error), 400);
    }

    return c.html(
      loginPage(
        undefined,
        "Check your email for a sign-in link. It expires in 15 minutes.",
      ),
    );
  } catch (error) {
    console.error("[auth/login] failed", error);
    const message =
      error instanceof EmailDeliveryError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Something went wrong.";
    return c.html(loginPage(message), 400);
  }
});

app.get("/auth/verify", async (c) => {
  const token = c.req.query("token");
  if (!token) {
    return c.redirect("/?error=Missing+token", 302);
  }

  const verified = await verifyMagicLink(c.env, token, isSecure(c.req.raw));
  if (!verified) {
    return c.redirect("/?error=Invalid+or+expired+link", 302);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/dashboard",
      "Set-Cookie": verified.cookie,
    },
  });
});

app.post("/auth/logout", async (c) => {
  await logout(c.env, c.req.raw);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": clearSessionCookie(isSecure(c.req.raw)),
    },
  });
});

app.get("/dashboard", async (c) => {
  const user = await getSessionUser(c.env, c.req.raw);
  if (!user) return c.redirect("/", 302);

  const records = await listPriceRecords(c.env.PRICE_HISTORY, user.id);
  const lastRunAt = await c.env.PRICE_HISTORY.get("tracker:lastRunAt");
  const nextRunEstimate = await getNextRunEstimate(c.env);
  const profile = getSearchProfile(parseSearchTier(c.env.SEARCH_TIER));

  return c.html(
    dashboardPage(
      {
        user,
        records,
        lastRunAt,
        nextRunEstimate,
        tierLabel: profile.label,
        message: c.req.query("message") ?? undefined,
        error: c.req.query("error") ?? undefined,
      },
      c.env,
    ),
  );
});

app.post("/settings", async (c) => {
  const user = await getSessionUser(c.env, c.req.raw);
  if (!user) return c.redirect("/", 302);

  const form = await c.req.parseBody();
  const origin = normalizeIata(String(form.origin ?? ""));
  const destination = normalizeIata(String(form.destination ?? ""));
  const hubs = parseHubList(String(form.hubs ?? ""));
  const alertMin = Number.parseInt(String(form.alert_min ?? ""), 10);
  const alertMax = Number.parseInt(String(form.alert_max ?? ""), 10);

  if (!isValidIata(origin) || !isValidIata(destination)) {
    return c.redirect(
      "/dashboard?error=Use+3-letter+airport+codes+(e.g.+YYT,+DEL).",
      302,
    );
  }

  if (origin === destination) {
    return c.redirect(
      "/dashboard?error=Origin+and+destination+must+be+different.",
      302,
    );
  }

  if (hubs.length === 0) {
    return c.redirect(
      "/dashboard?error=Add+at+least+one+connection+hub+(e.g.+YYZ,+YUL).",
      302,
    );
  }

  if (
    !Number.isFinite(alertMin) ||
    !Number.isFinite(alertMax) ||
    alertMin < ALERT_MIN_BOUND ||
    alertMax > ALERT_MAX_BOUND ||
    alertMin >= alertMax
  ) {
    return c.redirect(
      "/dashboard?error=Invalid+price+range.+Min+must+be+less+than+max.",
      302,
    );
  }

  await updateUserSettings(c.env.DB, user.id, {
    origin,
    destination,
    hubs: formatHubList(hubs),
    alertMin,
    alertMax,
  });
  return c.redirect("/dashboard?message=Your+trip+settings+were+saved.", 302);
});

app.get("/run", async (c) => {
  const user = await getSessionUser(c.env, c.req.raw);
  if (!user) return c.text("Unauthorized", 401);

  const result = await runTracker(c.env, {
    skipIntervalGate: true,
    manual: true,
  });

  if (result.skipped) {
    return c.redirect(
      `/dashboard?error=${encodeURIComponent(result.skipReason ?? "Run skipped")}`,
      302,
    );
  }

  const nextLine = result.log.find((line) =>
    line.startsWith("Next automatic check:"),
  );
  const nextRunAt = nextLine?.slice("Next automatic check: ".length);
  const message = nextRunAt
    ? `Price check complete. Next automatic check ${new Date(nextRunAt).toLocaleString()}.`
    : "Price check complete.";

  return c.redirect(
    `/dashboard?message=${encodeURIComponent(message)}`,
    302,
  );
});

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runTracker(env, { skipIntervalGate: false }));
  },
};
