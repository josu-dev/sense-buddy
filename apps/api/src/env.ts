export const env = {
  port: Number(process.env.PORT ?? 8787),
  databasePath: process.env.DATABASE_PATH ?? "./data/sense-buddy.db",
  allowMockAuth: process.env.ALLOW_MOCK_AUTH !== "false",
  dailyTokenBudget: Number(process.env.DAILY_TOKEN_BUDGET ?? 60_000),
  llmApiKey: process.env.LLM_API_KEY ?? "",
  llmBaseUrl: (process.env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, ""),
  llmVisionModel: process.env.LLM_VISION_MODEL ?? "meta-llama/llama-4-scout",
  llmTextModel: process.env.LLM_TEXT_MODEL ?? "meta-llama/llama-3.3-70b-instruct",
  /** Speech-to-text for the generic backend (OpenAI-compatible /audio/transcriptions). Groq default. */
  llmSttModel: process.env.LLM_STT_MODEL ?? "whisper-large-v3-turbo",
  sam3ApiUrl: process.env.SAM3_API_URL ?? "",
  sam3ApiKey: process.env.SAM3_API_KEY ?? "",
  // Meta Model API (dev.meta.ai). When META_API_KEY (aka MODEL_API_KEY) is set,
  // chat/vision go to https://api.meta.ai/v1 with Muse Spark, SAM 3.1 via
  // Responses API, and STT via /v1/asr/transcribe. Falls back to LLM_* above.
  metaApiKey: process.env.META_API_KEY ?? process.env.MODEL_API_KEY ?? "",
  metaBaseUrl: (process.env.META_BASE_URL ?? "https://api.meta.ai/v1").replace(/\/$/, ""),
  metaVisionModel: process.env.META_VISION_MODEL ?? "muse-spark-1.3",
  metaTextModel: process.env.META_TEXT_MODEL ?? "muse-spark-1.3",
  metaSamModel: process.env.META_SAM_MODEL ?? "sam-3.1",
  metaAsrModel: process.env.META_ASR_MODEL ?? "muse-voice-transcribe-1.0",
};

export const useMeta = (): boolean => env.metaApiKey.length > 0;
const effectiveKey = (): string => (useMeta() ? env.metaApiKey : env.llmApiKey);
const effectiveBaseUrl = (): string => (useMeta() ? env.metaBaseUrl : env.llmBaseUrl);

export const aiMode = (): "live" | "mock" => (effectiveKey() ? "live" : "mock");
