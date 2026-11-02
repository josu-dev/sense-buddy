#!/usr/bin/env node
/**
 * Install the team's shared Android DEBUG keystore.
 *
 * Why this exists: Google OAuth (Android client) binds package name
 * (`app.sensebuddy`) + SHA-1 certificate fingerprint. If every teammate
 * builds with their own random `~/.android/debug.keystore`, everyone gets a
 * different SHA-1 and needs their own OAuth client. By checking ONE debug
 * key into the repo and installing it here, the whole team shares a single
 * SHA-1 and a single Google Cloud Android client.
 *
 * SECURITY: this is a DEBUG key only (password `android`, publicly known
 * pattern). NEVER use it for release/Play Store signing. Release keys stay
 * private and are never committed.
 *
 * Usage:
 *   pnpm setup:android-debug          # install + print SHA-1 for Google Cloud
 *   node scripts/setup-android-debug.mjs --check        # CI: exit 1 if missing/different
 *   node scripts/setup-android-debug.mjs --print-sha1   # just print fingerprints
 *
 * Google Cloud fill-in (one Android client in the same project as Web/iOS):
 *   Package name: app.sensebuddy
 *   SHA-1:        <printed by this script>
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CHECKED_IN = join(here, "android-debug", "debug.keystore");

// SHA-1 of the cert inside CHECKED_IN (recomputed below via openssl when
// available; kept here as fallback so the script works without openssl).
const EXPECTED_SHA1_COLON = "F4:1A:37:C1:D8:DE:CA:D3:9D:41:88:B5:31:EC:28:76:6B:8C:CA:98";
const EXPECTED_SHA1_PLAIN = EXPECTED_SHA1_COLON.replaceAll(":", "");

const target = () => {
  if (process.env.ANDROID_DEBUG_KEYSTORE) return process.env.ANDROID_DEBUG_KEYSTORE;
  return join(homedir(), ".android", "debug.keystore");
};

const sha256File = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

/** Best-effort: recompute SHA-1 from a PKCS#12 keystore via openssl. */
function fingerprintSha1(keystorePath) {
  try {
    const pem = execFileSync(
      "openssl",
      ["pkcs12", "-in", keystorePath, "-clcerts", "-nokeys", "-passin", "pass:android"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const out = execFileSync("openssl", ["x509", "-noout", "-fingerprint", "-sha1"], {
      input: pem,
      stdio: ["pipe", "pipe", "ignore"],
    }).toString();
    const m = out.match(/=([0-9A-Fa-f:]+)/);
    return m ? m[1].toUpperCase() : null;
  } catch {
    return null;
  }
}

function printFingerprints(sha1Colon) {
  const colon = sha1Colon ?? EXPECTED_SHA1_COLON;
  const plain = colon.replaceAll(":", "");
  console.log(`  SHA-1 (colons):    ${colon}`);
  console.log(`  SHA-1 (no colons): ${plain}`);
}

const args = new Set(process.argv.slice(2));
const dest = target();

if (!existsSync(CHECKED_IN)) {
  console.error(`Missing checked-in key: ${CHECKED_IN}`);
  process.exit(1);
}

if (args.has("--print-sha1")) {
  printFingerprints(fingerprintSha1(CHECKED_IN));
  process.exit(0);
}

const needInstall = !existsSync(dest) || sha256File(dest) !== sha256File(CHECKED_IN);

if (args.has("--check")) {
  if (needInstall) {
    console.error(`Android debug keystore mismatch. Run: pnpm setup:android-debug`);
    process.exit(1);
  }
  console.log(`Android debug keystore OK: ${dest}`);
  printFingerprints(fingerprintSha1(dest));
  process.exit(0);
}

if (needInstall && !(args.has("--force") || !existsSync(dest))) {
  // A personal debug key already exists — don't clobber silently.
  console.error(`Refusing to overwrite existing key at ${dest} (differs from team's).`);
  console.error(`Back it up, then re-run with --force, or keep it and register`);
  console.error(`your own SHA-1 as a second Android OAuth client instead.`);
  process.exit(1);
}

if (needInstall || args.has("--force")) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(CHECKED_IN, dest);
  try {
    const { chmodSync } = await import("node:fs");
    chmodSync(dest, 0o600);
  } catch {
    /* non-POSIX, ignore */
  }
  console.log(`Installed team debug keystore -> ${dest}`);
} else {
  console.log(`Team debug keystore already installed: ${dest}`);
}

printFingerprints(fingerprintSha1(dest));
console.log(``);
console.log(`Google Cloud > Credentials > Android client:`);
console.log(`  Package: app.sensebuddy`);
console.log(`  SHA-1:   ${EXPECTED_SHA1_PLAIN} (or colon form above)`);
