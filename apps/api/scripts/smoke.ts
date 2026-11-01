/** Smoke test against a running API: `pnpm dev` in one terminal, `pnpm smoke` here. */
export {};
const base = process.env.API_URL ?? "http://localhost:8787";

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const json = await res.json().catch(() => null);
  console.log(`${init.method ?? "GET"} ${path} → ${res.status}`, JSON.stringify(json)?.slice(0, 220));
  if (!res.ok) throw new Error(`FAILED ${path}`);
  return json as Record<string, string>;
}

const health = await call("/health");
console.log("aiMode:", health.aiMode);
// Real guest flow (BetterAuth anonymous plugin): fresh user + Bearer token,
// rename after sign-in, revoke on sign-out.
{
  const anon = await fetch(`${base}/api/auth/sign-in/anonymous`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const anonToken = anon.headers.get("set-auth-token");
  const anonBody = (await anon.json().catch(() => null)) as { user?: { id: string; name: string; isAnonymous?: boolean } } | null;
  console.log(`POST /api/auth/sign-in/anonymous → ${anon.status}`, JSON.stringify(anonBody)?.slice(0, 160), `token:${anonToken ? "yes" : "NO"}`);
  if (!anon.ok || !anonToken || !anonBody?.user?.isAnonymous) throw new Error("FAILED anonymous sign-in");
  const authz = { Authorization: `Bearer ${anonToken}`, "Content-Type": "application/json" };
  const meRes = await fetch(`${base}/api/me`, { headers: authz });
  const me = (await meRes.json().catch(() => null)) as { user?: { name: string }; preference?: unknown } | null;
  console.log(`GET /api/me (guest) → ${meRes.status}`, `name:${me?.user?.name}`, `preference:${me?.preference === null ? "null(new)" : "set"}`);
  if (!meRes.ok || me?.preference !== null) throw new Error("FAILED guest /api/me");
  await fetch(`${base}/api/auth/update-user`, { method: "POST", headers: authz, body: JSON.stringify({ name: "Smoke Guest" }) });
  const me2 = (await (await fetch(`${base}/api/me`, { headers: authz })).json()) as { user?: { name: string } };
  if (me2.user?.name !== "Smoke Guest") throw new Error("FAILED guest rename");
  console.log("guest rename → Smoke Guest OK");
  const out = await fetch(`${base}/api/auth/sign-out`, { method: "POST", headers: authz, body: "{}" });
  const meAfter = await fetch(`${base}/api/me`, { headers: authz });
  console.log(`POST /api/auth/sign-out → ${out.status}, /api/me after → ${meAfter.status}`);
  if (!out.ok || meAfter.status !== 401) throw new Error("FAILED sign-out");
}
const login = await call("/api/dev/mock-login", { method: "POST", body: JSON.stringify({ provider: "google", name: "Smoke Tester" }) });
const auth = { Authorization: `Bearer ${login.token}` };
await call("/api/me", { headers: auth });
await call("/api/ai/chat", { method: "POST", headers: auth, body: JSON.stringify({ mode: "visual", message: "What can you do?", history: [] }) });
// 8x8 gray JPEG: mock accepts anything, live vision needs decodable bytes.
const tinyJpeg =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwAooooA/9k=";
await call("/api/ai/see", { method: "POST", headers: auth, body: JSON.stringify({ question: "Is it safe to cross?", imageBase64: tinyJpeg }) });
await call("/api/ai/listen", { method: "POST", headers: auth, body: JSON.stringify({ intent: "scan", userName: "Smoke" }) });
await call("/api/me/usage", { headers: auth });
console.log("SMOKE OK");
