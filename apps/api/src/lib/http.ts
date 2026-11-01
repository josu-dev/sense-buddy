import type { Context, Next } from "hono";
import { auth } from "../auth";

export type AuthedUser = { id: string; email: string; name: string; isAnonymous?: boolean | null };
export type AppEnv = { Variables: { user: AuthedUser } };

/** Resolve the BetterAuth session (cookie or Bearer token) or 401. */
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", session.user as AuthedUser);
  await next();
}

/** Fixed-window rate limit, keyed by user (falls back to IP) + bucket name. */
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(bucket: string, max: number, windowMs = 60_000) {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = c.get("user") as AuthedUser | undefined;
    const ip = c.req.header("x-forwarded-for") ?? "local";
    const key = `${bucket}:${user?.id ?? ip}`;
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || entry.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count += 1;
      if (entry.count > max) {
        c.header("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
        return c.json({ error: "rate_limited", message: "Too many requests. Please slow down." }, 429);
      }
    }
    const current = buckets.get(key)!;
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(Math.max(0, max - current.count)));
    await next();
  };
}
