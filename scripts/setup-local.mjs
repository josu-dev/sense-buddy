#!/usr/bin/env node
/**
 * Local environment setup for Sense Buddy.
 *
 * Stage 1 (current): writes the API URL the mobile app should reach.
 *   - On a real phone via Expo Go, `localhost` is the phone itself, so we
 *     auto-detect this machine's LAN IP and use that instead.
 * Later stages can plug in here: API .env scaffolding, key prompts, QR hints…
 *
 * Usage:
 *   pnpm setup:local                 # auto-detect LAN IP, port 8787
 *   pnpm setup:local -- --port 8791  # if your API runs on another port
 *   pnpm setup:local -- --ip 192.168.1.42
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  }
  return args;
}

/** First private LAN IPv4, skipping docker/virtual/tunnel interfaces. */
function detectLanIp() {
  const skip = /docker|veth|br-|virbr|vmnet|utun|tun|tap|tailscale|zt|wg/i;
  const candidates = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (skip.test(name) || !addrs) continue;
    for (const a of addrs) {
      if (a.family !== "IPv4" || a.internal) continue;
      // Prefer typical home/office LAN ranges over carrier/VPN ranges.
      const score = a.address.startsWith("192.168.") ? 0 : a.address.startsWith("10.") ? 1 : a.address.startsWith("172.") ? 2 : 3;
      candidates.push({ address: a.address, score });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.address ?? "localhost";
}

/** Insert or replace one KEY=value line, preserving everything else in the file. */
function upsertEnvVar(filePath, key, value) {
  const lines = existsSync(filePath) ? readFileSync(filePath, "utf8").split("\n") : [];
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const line = `${key}=${value}`;
  if (idx >= 0) lines[idx] = line;
  else lines.push(line);
  writeFileSync(filePath, lines.join("\n").replace(/\n+$/, "\n"));
}

const args = parseArgs(process.argv.slice(2));
const port = args.port ?? process.env.API_PORT ?? "8787";
const ip = args.ip ?? detectLanIp();
const apiUrl = `http://${ip}:${port}`;

// --- Stage 1: mobile API URL ------------------------------------------------
const mobileEnv = join(root, "apps/mobile/.env");
upsertEnvVar(mobileEnv, "EXPO_PUBLIC_API_URL", apiUrl);

// --- Future stages go here ---------------------------------------------------
// e.g. scaffold apps/api/.env, prompt for LLM_API_KEY, check ports are free…

console.log(`Sense Buddy local setup`);
console.log(`  API URL (mobile): ${apiUrl}`);
console.log(`  Written to:       apps/mobile/.env`);
console.log("");
console.log("Next:");
console.log(`  1. pnpm dev:api      ${port !== "8787" ? `(with PORT=${port})` : ""}`);
console.log("  2. pnpm dev:mobile   → scan the QR with Expo Go (same Wi-Fi)");
if (ip === "localhost") {
  console.log("");
  console.log("Note: no LAN IP detected, fell back to localhost — fine for simulators/web,");
  console.log("but a real phone needs your LAN IP: pnpm setup:local -- --ip <your-ip>");
}
