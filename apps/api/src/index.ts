import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { z } from "zod";
import { auth } from "./auth";
import { db, schema } from "./db";
import { aiMode, env } from "./env";
import { rateLimit, requireAuth, type AppEnv, type AuthedUser } from "./lib/http";
import { usageSummary } from "./lib/usage";
import { aiRoutes } from "./routes/ai";

const app = new Hono<AppEnv>();

app.use("*", logger());
app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization"], exposeHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-Token-Remaining"] }));

app.get("/health", (c) => c.json({ ok: true, service: "sense-buddy-api", aiMode: aiMode(), mockAuth: env.allowMockAuth }));

// BetterAuth: /api/auth/sign-in/email, /sign-up/email, /sign-in/social, ...
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

/**
 * Mock OAuth for the hackathon build. The mobile "Continue with Google/Apple"
 * buttons call this; it creates/fetches a real BetterAuth user and returns a
 * real Bearer session token, so every other endpoint is exercised for real.
 * Disabled with ALLOW_MOCK_AUTH=false once real social providers are set.
 */
app.post("/api/dev/mock-login", rateLimit("mock-login", 10), async (c) => {
  if (!env.allowMockAuth) return c.json({ error: "mock_auth_disabled" }, 403);
  const body = z
    .object({ provider: z.enum(["google", "apple", "guest"]).default("google"), name: z.string().min(1).max(80).default("Demo Friend") })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);
  const { provider, name } = body.data;
  const email = `${provider}.demo@sensebuddy.app`;
  const password = `demo-${provider}-sense-buddy`; // server-side only, mock users only

  await auth.api.signUpEmail({ body: { name, email, password } }).catch(() => undefined); // already exists → fine
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const token = res.headers.get("set-auth-token");
  const payload = (await res.clone().json().catch(() => null)) as { user?: AuthedUser } | null;
  if (!res.ok || !token || !payload?.user) return c.json({ error: "mock_login_failed" }, 500);

  await db
    .insert(schema.preference)
    .values({ userId: payload.user.id, mode: "visual", updatedAt: new Date() })
    .onConflictDoNothing();
  return c.json({ token, user: payload.user });
});

app.get("/api/me", requireAuth, async (c) => {
  const user = c.get("user") as AuthedUser;
  const [prefs] = await db.select().from(schema.preference).where(eq(schema.preference.userId, user.id));
  return c.json({ user, preference: prefs ?? null, usage: await usageSummary(user.id) });
});

app.get("/api/me/usage", requireAuth, async (c) => {
  const user = c.get("user") as AuthedUser;
  return c.json(await usageSummary(user.id));
});

const PreferencePatch = z.object({
  mode: z.enum(["visual", "hearing"]).optional(),
  voiceRate: z.number().min(0.5).max(2).optional(),
  hapticsEnabled: z.boolean().optional(),
  captionSize: z.enum(["large", "xlarge"]).optional(),
  highContrast: z.boolean().optional(),
});

app.patch("/api/me/preferences", requireAuth, async (c) => {
  const user = c.get("user") as AuthedUser;
  const body = PreferencePatch.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);
  const values = { userId: user.id, mode: body.data.mode ?? ("visual" as const), ...body.data, updatedAt: new Date() };
  await db
    .insert(schema.preference)
    .values(values)
    .onConflictDoUpdate({ target: schema.preference.userId, set: { ...body.data, updatedAt: new Date() } });
  const [prefs] = await db.select().from(schema.preference).where(eq(schema.preference.userId, user.id));
  return c.json({ preference: prefs });
});

app.route("/api/ai", aiRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`Sense Buddy API on http://localhost:${info.port} (AI: ${aiMode()}, mockAuth: ${env.allowMockAuth})`);
});

export default app;
