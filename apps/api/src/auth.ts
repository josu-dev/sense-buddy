import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { db, schema } from "./db";

const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
}
if (process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
  socialProviders.apple = { clientId: process.env.APPLE_CLIENT_ID, clientSecret: process.env.APPLE_CLIENT_SECRET };
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me-please-32chars",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:8787",
  emailAndPassword: { enabled: true },
  socialProviders,
  // bearer: the Expo app stores the session token in SecureStore and sends
  // `Authorization: Bearer <token>` — no cookies in React Native.
  plugins: [bearer()],
  trustedOrigins: ["sensebuddy://*", "exp://*"],
  rateLimit: { enabled: true, window: 60, max: 100 },
});
