import * as AuthSession from "expo-auth-session";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

WebBrowser.maybeCompleteAuthSession();

/**
 * Real Google sign-in for the Expo app (browser-based, no native SDK).
 *
 * Flow: the app opens Google in a secure browser tab and requests an ID
 * token directly (`response_type=id_token` + PKCE-less implicit flow, still
 * supported per Google's OIDC discovery doc). The ID token + nonce go to our
 * API (`POST /api/auth/sign-in/social`), where BetterAuth verifies the
 * signature/audience server-side and returns a Bearer session. No Google
 * secret ever lives on the device.
 *
 * Requirements (dev build — NOT Expo Go, whose `exp://` redirect can't be
 * allowlisted in Google Cloud):
 *   - Google Cloud OAuth clients (web + iOS + Android) in one project, with
 *     the `sensebuddy://auth` redirect allowlisted (see apps/api/.env.example)
 *   - EXPO_PUBLIC_GOOGLE_{IOS,ANDROID,WEB}_CLIENT_ID set for this app
 *   - GOOGLE_*_CLIENT_ID + GOOGLE_CLIENT_SECRET set on the API
 *
 * When unavailable (Expo Go, missing IDs, user cancels, network error), the
 * caller falls back to the mock/demo login so the demo never dead-ends.
 */

const GOOGLE_ISSUER = "https://accounts.google.com";

/** Thrown when the user backs out of the Google browser tab (no fallback, no noise). */
export class GoogleAuthCancelled extends Error {
  constructor() {
    super("Google sign-in cancelled");
  }
}

/** Platform client ID, or null when Google auth isn't configured. */
export function getGoogleClientId(): string | null {
  const generic = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
  if (generic) return generic;
  if (Platform.OS === "ios") return process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? null;
  if (Platform.OS === "android") return process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? null;
  return process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? null;
}

/** False in Expo Go (redirect can't be allowlisted) or without a client ID. */
export function isGoogleAuthAvailable(): boolean {
  if (Constants.appOwnership === "expo") return false;
  return !!getGoogleClientId();
}

/** Deep link Google redirects back to after login (`sensebuddy://auth`). */
export function getGoogleRedirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: "sensebuddy", path: "auth" });
}

/**
 * Run the one-tap Google browser flow. Resolves with the verified-claim
 * inputs for `api.signInWithGoogle`. Single browser session — never retried
 * internally, so a failure surfaces once and the caller falls back to demo.
 */
export async function requestGoogleIdToken(): Promise<{ idToken: string; nonce: string }> {
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error("Google sign-in is not configured");
  const discovery = await AuthSession.fetchDiscoveryAsync(GOOGLE_ISSUER);
  const nonce = Crypto.randomUUID();
  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri: getGoogleRedirectUri(),
    scopes: ["openid", "profile", "email"],
    responseType: AuthSession.ResponseType.IdToken,
    usePKCE: false, // implicit flow: no code to exchange, nothing to prove
    extraParams: { nonce }, // required by Google for id_token; echoed back for verification
  });
  const result = await request.promptAsync(discovery);
  if (result.type === "cancel" || result.type === "dismiss") throw new GoogleAuthCancelled();
  if (result.type !== "success") {
    const detail = result.type === "error" ? `: ${result.error?.message ?? result.params.error ?? "unknown"}` : "";
    throw new Error(`Google sign-in failed${detail}`);
  }
  const idToken = result.params.id_token;
  if (typeof idToken !== "string" || !idToken) throw new Error("Google did not return an ID token");
  return { idToken, nonce };
}

export const isGoogleCancel = (e: unknown): boolean => e instanceof GoogleAuthCancelled;
