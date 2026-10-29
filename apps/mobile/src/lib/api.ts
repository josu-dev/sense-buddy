import type { ChatResponse, ListenResponse, Mode, SeeResponse, TalkResponse } from "@sense-buddy/shared";
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

export const api = {
  baseUrl: API_URL,
  /** Mock OAuth (hackathon). Swaps 1:1 for BetterAuth social sign-in later. */
  async mockLogin(provider: "google" | "apple" | "guest", name: string) {
    const data = await request<{ token: string; user: { id: string; name: string; email: string } }>("/api/dev/mock-login", {
      method: "POST",
      body: JSON.stringify({ provider, name }),
    });
    await setToken(data.token);
    return data;
  },
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
  syncPreferences: (body: Record<string, unknown>) =>
    request("/api/me/preferences", { method: "PATCH", body: JSON.stringify(body) }).catch(() => null),
};
