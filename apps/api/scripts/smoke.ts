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
const login = await call("/api/dev/mock-login", { method: "POST", body: JSON.stringify({ provider: "google", name: "Smoke Tester" }) });
const auth = { Authorization: `Bearer ${login.token}` };
await call("/api/me", { headers: auth });
await call("/api/ai/chat", { method: "POST", headers: auth, body: JSON.stringify({ mode: "visual", message: "What can you do?", history: [] }) });
await call("/api/ai/see", { method: "POST", headers: auth, body: JSON.stringify({ question: "Is it safe to cross?", imageBase64: "x".repeat(64) }) });
await call("/api/ai/listen", { method: "POST", headers: auth, body: JSON.stringify({ intent: "scan", userName: "Smoke" }) });
await call("/api/me/usage", { headers: auth });
console.log("SMOKE OK");
