import { Hono } from "hono";
import { isValidIata, normalizeIata } from "./airports";
import {
  ALERT_MAX_BOUND,
  ALERT_MIN_BOUND,
  getSearchProfile,
  MAX_CHECK_INTERVAL_DAYS,
  MAX_STOPS_MAX,
  MAX_STOPS_MIN,
  MIN_CHECK_INTERVAL_DAYS,
  parseSearchTier,
} from "./constants";
import { validateTripDateSettings } from "./dates";
import {
  clearSessionCookie,
  getSessionUser,
  loginWithInvite,
  logout,
  verifyMagicLink,
} from "./auth";
import {
  getUserById,
  setUserAutoCheck,
  updateUserSettings,
} from "./db";
import { EmailDeliveryError } from "./email";
import { dashboardPage, loginPage } from "./html";
import { getQuotaStatus } from "./quota";
import { getGlobalScheduleStatus, recordCronInvocation } from "./schedule";
import {
  getNextRunEstimate,
  getUserLastCheckAt,
  listPriceRecords,
  runTracker,
} from "./tracker";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

function isSecure(request: Request): boolean {
  const url = new URL(request.url);
  return url.protocol === "https:" || url.hostname === "localhost";
}

function formatNextRunMessage(value: string): string {
  if (value === "Pending first run") return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
  const lastRunAt = await getUserLastCheckAt(c.env.PRICE_HISTORY, user.id);
  const nextRunEstimate = await getNextRunEstimate(c.env, user);
  const globalSchedule = await getGlobalScheduleStatus(c.env);
  const profile = getSearchProfile(parseSearchTier(c.env.SEARCH_TIER));
  const quota = await getQuotaStatus(c.env);
  const showQuotaPopup =
    quota.exhausted || c.req.query("quota_exhausted") === "1";

  return c.html(
    dashboardPage(
      {
        user,
        records,
        lastRunAt,
        nextRunEstimate,
        globalSchedule,
        tierLabel: profile.label,
        quotaUsed: quota.used,
        quotaLimit: quota.limit,
        quotaExhausted: quota.exhausted,
        showQuotaPopup,
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
  const alertMin = Number.parseInt(String(form.alert_min ?? ""), 10);
  const alertMax = Number.parseInt(String(form.alert_max ?? ""), 10);
  const maxStops = Number.parseInt(String(form.max_stops ?? ""), 10);
  const autoCheck = form.auto_check === "1" || form.auto_check === "on";
  const checkIntervalDays = Number.parseInt(
    String(form.check_interval_days ?? ""),
    10,
  );
  const departStart = String(form.depart_start ?? "").trim();
  const departEnd = String(form.depart_end ?? "").trim();
  const returnStart = String(form.return_start ?? "").trim();
  const returnEnd = String(form.return_end ?? "").trim();
  const tripMinDays = Number.parseInt(String(form.trip_min_days ?? ""), 10);

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

  if (
    !Number.isFinite(maxStops) ||
    maxStops < MAX_STOPS_MIN ||
    maxStops > MAX_STOPS_MAX
  ) {
    return c.redirect(
      `/dashboard?error=Max+stops+must+be+between+${MAX_STOPS_MIN}+and+${MAX_STOPS_MAX}.`,
      302,
    );
  }

  if (
    !Number.isFinite(checkIntervalDays) ||
    checkIntervalDays < MIN_CHECK_INTERVAL_DAYS ||
    checkIntervalDays > MAX_CHECK_INTERVAL_DAYS
  ) {
    return c.redirect(
      `/dashboard?error=Check+interval+must+be+between+${MIN_CHECK_INTERVAL_DAYS}+and+${MAX_CHECK_INTERVAL_DAYS}+days.`,
      302,
    );
  }

  const dateError = validateTripDateSettings({
    departStart,
    departEnd,
    returnStart,
    returnEnd,
    tripMinDays,
  });
  if (dateError) {
    return c.redirect(`/dashboard?error=${encodeURIComponent(dateError)}`, 302);
  }

  await updateUserSettings(c.env.DB, user.id, {
    origin,
    destination,
    alertMin,
    alertMax,
    maxStops,
    departStart,
    departEnd,
    returnStart,
    returnEnd,
    tripMinDays,
    checkIntervalDays,
    autoCheck,
  });
  return c.redirect("/dashboard?message=Your+trip+settings+were+saved.", 302);
});

app.post("/cron/user/toggle", async (c) => {
  const actor = await getSessionUser(c.env, c.req.raw);
  if (!actor) return c.redirect("/", 302);

  const form = await c.req.parseBody();
  const userId = String(form.user_id ?? "").trim();
  const enable = form.enable === "1";

  if (!userId) {
    return c.redirect("/dashboard?error=Missing+user.", 302);
  }

  const target = await getUserById(c.env.DB, userId);
  if (!target || !target.active) {
    return c.redirect("/dashboard?error=User+not+found.", 302);
  }

  await setUserAutoCheck(c.env.DB, userId, enable);
  const message = enable
    ? `Automatic checks resumed for ${target.email}.`
    : `Automatic checks paused for ${target.email}. Manual Run now still works.`;

  return c.redirect(`/dashboard?message=${encodeURIComponent(message)}`, 302);
});

app.get("/run", async (c) => {
  const user = await getSessionUser(c.env, c.req.raw);
  if (!user) return c.text("Unauthorized", 401);

  const result = await runTracker(c.env, {
    skipIntervalGate: true,
    manual: true,
  });

  if (result.skipped) {
    const quotaParam = result.quotaExhausted ? "&quota_exhausted=1" : "";
    return c.redirect(
      `/dashboard?error=${encodeURIComponent(result.skipReason ?? "Run skipped")}${quotaParam}`,
      302,
    );
  }

  const nextRunAt = await getNextRunEstimate(c.env, user);
  const message =
    nextRunAt && nextRunAt !== "Pending first run"
      ? `Price check complete. Next automatic check ${formatNextRunMessage(nextRunAt)}.`
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
    ctx.waitUntil(
      (async () => {
        const result = await runTracker(env, { skipIntervalGate: false });
        await recordCronInvocation(env.PRICE_HISTORY, {
          skipped: result.skipped,
          skipReason: result.skipReason,
          usersChecked: result.usersChecked,
          searchCount: result.searchCount,
        });
      })(),
    );
  },
};
