import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous, bearer } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";

type SocialProvider = { clientId: string | string[]; clientSecret: string };
const socialProviders: Record<string, SocialProvider> = {};
// Google issues one OAuth client per platform (web/iOS/Android) in the same
// Cloud project. The array form lets BetterAuth verify ID tokens from any of
// them — the mobile app signs in with its platform client and forwards the
// ID token (POST /api/auth/sign-in/social, no browser redirect dance).
const googleClientIds = [
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_WEB_CLIENT_ID,
  process.env.GOOGLE_IOS_CLIENT_ID,
  process.env.GOOGLE_ANDROID_CLIENT_ID,
].filter((v): v is string => !!v);
if (googleClientIds.length > 0 && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: googleClientIds.length === 1 ? googleClientIds[0] : [...new Set(googleClientIds)],
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
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
  plugins: [
    // bearer: the Expo app stores the session token in SecureStore and sends
    // `Authorization: Bearer <token>` — no cookies in React Native. Every
    // sign-in (email, anonymous, social-idToken) returns the token in the
    // `set-auth-token` response header.
    bearer(),
    // anonymous: real guest accounts (POST /sign-in/anonymous) instead of a
    // shared mock user. Guests get a temp @sensebuddy.app email and can later
    // link a permanent method — onLinkAccount moves their profile + usage over.
    anonymous({
      emailDomainName: "sensebuddy.app",
      generateName: () => "Guest",
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        const anonId = anonymousUser.user.id;
        const newId = newUser.user.id;
        const [anonPref] = await db.select().from(schema.preference).where(eq(schema.preference.userId, anonId));
        if (anonPref) {
          const [newPref] = await db.select().from(schema.preference).where(eq(schema.preference.userId, newId));
          if (!newPref) {
            await db.update(schema.preference).set({ userId: newId }).where(eq(schema.preference.userId, anonId));
          } else {
            await db.delete(schema.preference).where(eq(schema.preference.userId, anonId));
          }
        }
        await db.update(schema.usageEvent).set({ userId: newId }).where(eq(schema.usageEvent.userId, anonId));
      },
    }),
  ],
  trustedOrigins: ["sensebuddy://", "sensebuddy://*", "exp://", "exp://*"],
  rateLimit: { enabled: true, window: 60, max: 100 },
  advanced: {
    // The only client is the mobile app, which authenticates with Bearer
    // tokens (SecureStore + `Authorization` header) — Bearer is immune to
    // CSRF by design, so cookie-based CSRF checks buy nothing here. Worse,
    // they actively break login: the phone's OS networking stack persists
    // the `better-auth.session_token` cookie from an earlier sign-in and
    // silently resends it (React Native fetch never sends `Origin`), so any
    // re-login with a stale cookie got 403 MISSING_OR_NULL_ORIGIN and the
    // user was stuck without a session. A stale cookie now simply yields no
    // session (401) and the app signs in again cleanly.
    disableCSRFCheck: true,
  },
});
