import { and, gte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "../db";
import { env } from "../env";

export async function tokensUsedToday(userId: string): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.usageEvent.totalTokens}), 0)` })
    .from(schema.usageEvent)
    .where(and(sql`${schema.usageEvent.userId} = ${userId}`, gte(schema.usageEvent.createdAt, start)));
  return Number(row?.total ?? 0);
}

export async function usageSummary(userId: string) {
  const used = await tokensUsedToday(userId);
  return { usedToday: used, dailyBudget: env.dailyTokenBudget, remaining: Math.max(0, env.dailyTokenBudget - used) };
}

/** Rough token estimate when an upstream provider does not report usage. */
export const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

export async function recordUsage(userId: string, route: string, inputTokens: number, outputTokens: number) {
  await db.insert(schema.usageEvent).values({
    id: randomUUID(),
    userId,
    route,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    createdAt: new Date(),
  });
}
