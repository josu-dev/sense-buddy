#!/usr/bin/env node
/**
 * Free the dev ports used by Sense Buddy (API + Expo/Metro).
 *
 * Finds processes LISTENING on each port and kills them (SIGTERM, then
 * SIGKILL if they don't exit in time). Ports already free are skipped.
 *
 * Usage:
 *   pnpm free:ports                        # API (PORT or 8787) + Expo (8081, 19000-19002, 19006)
 *   pnpm free:ports -- --port 8787         # single port (repeatable, comma-separated OK)
 *   pnpm free:ports -- --api-port 8791     # override just the API port
 *   PORT=8791 pnpm free:ports               # same via env
 */
import { execFileSync } from "node:child_process";

const DEFAULT_API_PORT = Number(process.env.PORT ?? 8787);
// Metro/Expo: 8081 (Metro bundler), 19000-19002 (Expo dev tools, legacy),
// 19006 (Expo web).
const DEFAULT_EXPO_PORTS = [8081, 19000, 19001, 19002, 19006];

function parseArgs(argv) {
  const args = { ports: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--port" || a === "--ports" || a === "-p") {
      const v = argv[++i] ?? "";
      args.ports.push(...v.split(",").map(Number).filter(Number.isFinite));
    } else if (a === "--api-port") {
      args.apiPort = Number(argv[++i]);
    } else if (a.startsWith("--port=")) {
      args.ports.push(...a.slice("--port=".length).split(",").map(Number).filter(Number.isFinite));
    } else if (a.startsWith("--api-port=")) {
      args.apiPort = Number(a.slice("--api-port=".length));
    } else if (/^\d+$/.test(a)) {
      args.ports.push(Number(a));
    }
  }
  return args;
}

function findPidsUnix(port) {
  // Preferred: lsof (macOS + most Linux).
  try {
    const out = execFileSync("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out) return [...new Set(out.split(/\s+/).map(Number).filter((n) => n > 0))];
    return [];
  } catch {
    // lsof missing or no match — fall through to ss/fuser.
  }
  // Fallback: ss.
  try {
    const out = execFileSync("ss", ["-lptn", `sport = :${port}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pids = [...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])).filter((n) => n > 0);
    if (pids.length > 0 || out.includes(`:${port}`)) return [...new Set(pids)];
  } catch {
    // ss missing — try fuser next.
  }
  // Fallback: fuser.
  try {
    const out = execFileSync("fuser", [`${port}/tcp`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out) return [...new Set(out.split(/\s+/).map(Number).filter((n) => n > 0))];
  } catch {
    // fuser exits non-zero when nobody holds the port (or when missing).
  }
  return [];
}

function findPidsWindows(port) {
  try {
    const out = execFileSync("netstat", ["-ano", "-p", "TCP"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: true,
    });
    const pids = [];
    for (const line of out.split("\n")) {
      //   TCP    0.0.0.0:8787    0.0.0.0:0    LISTENING    1234
      const m = line.match(/TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
      if (m && Number(m[1]) === port) pids.push(Number(m[2]));
    }
    return [...new Set(pids.filter((n) => n > 0))];
  } catch {
    return [];
  }
}

function findPids(port) {
  return process.platform === "win32" ? findPidsWindows(port) : findPidsUnix(port);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** SIGTERM, wait up to `graceMs`, then SIGKILL survivors. Returns per-pid outcome. */
async function killPids(pids, graceMs = 1500) {
  const results = [];
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      results.push({ pid, asked: true });
    } catch (err) {
      results.push({ pid, asked: false, error: err.code ?? String(err) });
    }
  }
  if (results.some((r) => r.asked)) await sleep(graceMs);
  for (const r of results) {
    if (!r.asked) continue;
    if (!isAlive(r.pid)) {
      r.killed = true;
      continue;
    }
    try {
      process.kill(r.pid, "SIGKILL");
      r.killed = true;
      r.forced = true;
    } catch (err) {
      r.killed = false;
      r.error = err.code ?? String(err);
    }
  }
  return results;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log("Free Sense Buddy dev ports by killing whatever listens on them.\n");
  console.log("Usage:");
  console.log("  pnpm free:ports                      API + Expo ports");
  console.log("  pnpm free:ports -- --port 8787        single port (repeatable, comma-separated OK)");
  console.log("  pnpm free:ports -- 8787 8081          positional ports also work");
  console.log("  pnpm free:ports -- --api-port 8791    override just the API port");
  console.log("  PORT=8791 pnpm free:ports             same via env");
  process.exit(0);
}

const apiPort = Number.isFinite(args.apiPort) ? args.apiPort : DEFAULT_API_PORT;
const ports = args.ports.length > 0 ? [...new Set(args.ports)] : [apiPort, ...DEFAULT_EXPO_PORTS];

let freed = 0;
let failed = 0;

for (const port of ports) {
  const label = port === apiPort ? "api" : "expo";
  const pids = findPids(port).filter((pid) => pid !== process.pid);
  if (pids.length === 0) {
    console.log(`  port ${port} (${label}) — free`);
    continue;
  }
  const results = await killPids(pids);
  for (const r of results) {
    if (r.killed) {
      freed++;
      console.log(`  port ${port} (${label}) — killed pid ${r.pid}${r.forced ? " (SIGKILL)" : ""}`);
    } else {
      failed++;
      console.log(`  port ${port} (${label}) — could not kill pid ${r.pid} (${r.error ?? "still running"})`);
    }
  }
}

console.log(freed === 0 && failed === 0 ? "All ports already free." : `Done: ${freed} process(es) killed${failed ? `, ${failed} failed` : ""}.`);
process.exit(failed ? 1 : 0);
