import type { ChatResponse, ListenResponse, Mode, PreferencePatch, SeeResponse, TalkResponse } from "@sense-buddy/shared";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { getAppLang } from "./i18n";

/**
 * All AI traffic goes to our Hono API — never directly to a model provider.
 * The API holds the Meta/Llama + SAM 3 keys, enforces per-user token quotas
 * and rate limits, so the client can neither leak keys nor abuse them.
 */
const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? Constants.expoConfig?.extra?.apiUrl ?? "http://localhost:8787";

const TOKEN_KEY = "sense-buddy-token";
let tokenCache: string | null | undefined;

export async function setToken(token: string | null) {
  tokenCache = token;
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function getToken(): Promise<string | null> {
  if (tokenCache !== undefined) return tokenCache;
  tokenCache = await SecureStore.getItemAsync(TOKEN_KEY);
  return tokenCache;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const isUnauthorized = (e: unknown): boolean => e instanceof ApiError && e.status === 401;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
    if (!res.ok) {
      if (res.status === 401) await setToken(null); // sesión inválida: no reintentar con el mismo token
      throw new ApiError(res.status, json?.message ?? json?.error ?? `Request failed (${res.status})`);
    }
    return json as T;
  } finally {
    clearTimeout(timeout);
  }
}

export type Usage = { usedToday: number; dailyBudget: number; remaining: number };

/** BetterAuth user as returned by sign-in + GET /api/me. */
export type AuthUser = { id: string; name: string; email: string; isAnonymous?: boolean | null };

/**
 * POST to a BetterAuth sign-in endpoint WITHOUT the stored session token (a
 * stale token would either leak the old session or make anonymous sign-in
 * fail). Captures the fresh Bearer token from the `set-auth-token` response
 * header (added by the server's bearer plugin on every sign-in).
 */
async function authRequest<T>(path: string, body: unknown): Promise<{ data: T; token: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
    if (!res.ok) throw new ApiError(res.status, json?.message ?? json?.error ?? `Request failed (${res.status})`);
    return { data: json as T, token: res.headers.get("set-auth-token") };
  } finally {
    clearTimeout(timeout);
  }
}

/** Pull the user object out of a BetterAuth sign-in payload (shape varies). */
function payloadUser(json: unknown): AuthUser | null {
  if (!json || typeof json !== "object") return null;
  const o = json as { user?: AuthUser; data?: { user?: AuthUser } };
  const u = o.user ?? o.data?.user;
  return u && typeof u.id === "string" ? u : null;
}

/** Server `preference` row as returned by GET /api/me (drizzle serializes dates). */
export type ServerPreference = PreferencePatch & { userId: string; updatedAt: string };

export type MeResponse = {
  user: AuthUser;
  preference: ServerPreference | null;
  usage: Usage;
};

export type SignInResult = { token: string; user: AuthUser };

export const api = {
  baseUrl: API_URL,
  /**
   * Real guest sign-in via the BetterAuth anonymous plugin: creates a fresh
   * guest user (temp @sensebuddy.app email, isAnonymous) + Bearer session.
   * The caller asks for the guest's name AFTER this resolves.
   */
  async signInAnonymous(): Promise<SignInResult> {
    const { data, token } = await authRequest<unknown>("/api/auth/sign-in/anonymous", {});
    const user = payloadUser(data);
    if (!token || !user) throw new ApiError(500, "Anonymous sign-in failed");
    await setToken(token);
    return { token, user };
  },
  /**
   * Real Google sign-in: the app obtains a Google ID token on-device
   * (see lib/googleAuth) and BetterAuth verifies it server-side — no secrets
   * on the device, no browser-cookie juggling. Returns a Bearer session.
   */
  async signInWithGoogle(idToken: string, nonce: string): Promise<SignInResult> {
    const { data, token } = await authRequest<unknown>("/api/auth/sign-in/social", {
      provider: "google",
      idToken: { token: idToken, nonce },
    });
    const user = payloadUser(data);
    if (!token || !user) throw new ApiError(500, "Google sign-in failed");
    await setToken(token);
    return { token, user };
  },
  /** Rename the current user (used for the post-guest name step). Best-effort offline. */
  updateUserName: (name: string) => request<{ status: boolean }>("/api/auth/update-user", { method: "POST", body: JSON.stringify({ name }) }),
  /** Revoke the server session (local token is cleared by the caller). */
  signOutServer: () => request<{ success: boolean }>("/api/auth/sign-out", { method: "POST", body: JSON.stringify({}) }),
  /** Mock OAuth (hackathon fallback). Used only when the real flows above are unavailable. */
  async mockLogin(provider: "google" | "apple" | "guest", name: string) {
    const data = await request<{ token: string; user: { id: string; name: string; email: string }; isNew: boolean }>(
      "/api/dev/mock-login",
      {
        method: "POST",
        body: JSON.stringify({ provider, name }),
      },
    );
    await setToken(data.token);
    return data;
  },
  me: () => request<MeResponse>("/api/me"),
  chat: (mode: Mode, message: string, history: { role: "user" | "assistant"; content: string }[] = []) =>
    request<ChatResponse>("/api/ai/chat", { method: "POST", body: JSON.stringify({ mode, message, history, lang: getAppLang() }) }),
  see: (question: string, imageBase64: string, mode: Mode) =>
    request<SeeResponse>("/api/ai/see", { method: "POST", body: JSON.stringify({ question, imageBase64, mode, lang: getAppLang() }) }),
  listen: (intent: "scan" | "speech", userName?: string, audioBase64?: string) =>
    request<ListenResponse>("/api/ai/listen", {
      method: "POST",
      body: JSON.stringify({ intent, userName, lang: getAppLang(), ...(audioBase64 ? { audioBase64 } : {}) }),
    }),
  talk: (audioBase64: string, mode: Mode) =>
    request<TalkResponse>("/api/ai/talk", { method: "POST", body: JSON.stringify({ audioBase64, mode, lang: getAppLang() }) }),
  usage: () => request<Usage>("/api/me/usage"),
  deleteAccount: () => request<{ deleted: boolean }>("/api/me", { method: "DELETE" }),
  syncPreferences: (body: PreferencePatch) =>
    request("/api/me/preferences", { method: "PATCH", body: JSON.stringify(body) }).catch(() => null),
};
