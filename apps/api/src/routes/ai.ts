import {
  ChatRequestSchema,
  ChatResponseSchema,
  ListenRequestSchema,
  ROUTE_TOKEN_COST,
  SeeRequestSchema,
} from "@sense-buddy/shared";
import { Hono } from "hono";
import type { AppEnv, AuthedUser } from "../lib/http";
import { rateLimit, requireAuth } from "../lib/http";
import { recordUsage, tokensUsedToday, usageSummary } from "../lib/usage";
import { env } from "../env";
import { analyzeScene, chatWithBuddy, listenAmbient } from "../providers/meta";

export const aiRoutes = new Hono<AppEnv>();

aiRoutes.use("*", requireAuth);

/** Quota gate: reject before spending upstream tokens the user does not have. */
async function ensureQuota(userId: string, route: keyof typeof ROUTE_TOKEN_COST) {
  const used = await tokensUsedToday(userId);
  return used + ROUTE_TOKEN_COST[route] <= env.dailyTokenBudget;
}

aiRoutes.post("/chat", rateLimit("ai-chat", 30), async (c) => {
  const user = c.get("user") as AuthedUser;
  const body = ChatRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request", details: body.error.issues }, 400);
  if (!(await ensureQuota(user.id, "chat"))) return c.json({ error: "quota_exceeded", usage: await usageSummary(user.id) }, 402);
  try {
    const result = await chatWithBuddy(body.data);
    await recordUsage(user.id, "chat", result.inputTokens, result.outputTokens);
    const usage = await usageSummary(user.id);
    c.header("X-Token-Remaining", String(usage.remaining));
    return c.json(ChatResponseSchema.parse({ reply: result.data.reply, shouldSpeak: body.data.mode === "visual" }));
  } catch (err) {
    return c.json({ error: "ai_unavailable", message: err instanceof Error ? err.message : "unknown" }, 502);
  }
});

aiRoutes.post("/see", rateLimit("ai-see", 20), async (c) => {
  const user = c.get("user") as AuthedUser;
  const body = SeeRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request", details: body.error.issues }, 400);
  if (!(await ensureQuota(user.id, "see"))) return c.json({ error: "quota_exceeded", usage: await usageSummary(user.id) }, 402);
  try {
    const result = await analyzeScene(body.data);
    await recordUsage(user.id, "see", result.inputTokens, result.outputTokens);
    c.header("X-Token-Remaining", String((await usageSummary(user.id)).remaining));
    return c.json(result.data);
  } catch (err) {
    return c.json({ error: "ai_unavailable", message: err instanceof Error ? err.message : "unknown" }, 502);
  }
});

aiRoutes.post("/listen", rateLimit("ai-listen", 30), async (c) => {
  const user = c.get("user") as AuthedUser;
  const body = ListenRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request", details: body.error.issues }, 400);
  if (!(await ensureQuota(user.id, "listen"))) return c.json({ error: "quota_exceeded", usage: await usageSummary(user.id) }, 402);
  try {
    const result = await listenAmbient(body.data);
    await recordUsage(user.id, "listen", result.inputTokens, result.outputTokens);
    return c.json(result.data);
  } catch (err) {
    return c.json({ error: "ai_unavailable", message: err instanceof Error ? err.message : "unknown" }, 502);
  }
});
