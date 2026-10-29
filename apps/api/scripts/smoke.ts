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
// 8x8 gray JPEG: mock accepts anything, live vision needs decodable bytes.
const tinyJpeg =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwAooooA/9k=";
await call("/api/ai/see", { method: "POST", headers: auth, body: JSON.stringify({ question: "Is it safe to cross?", imageBase64: tinyJpeg }) });
await call("/api/ai/listen", { method: "POST", headers: auth, body: JSON.stringify({ intent: "scan", userName: "Smoke" }) });
await call("/api/me/usage", { headers: auth });
console.log("SMOKE OK");
