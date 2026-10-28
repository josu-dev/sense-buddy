export const env = {
  port: Number(process.env.PORT ?? 8787),
  databasePath: process.env.DATABASE_PATH ?? "./data/sense-buddy.db",
  allowMockAuth: process.env.ALLOW_MOCK_AUTH !== "false",
  dailyTokenBudget: Number(process.env.DAILY_TOKEN_BUDGET ?? 60_000),
  llmApiKey: process.env.LLM_API_KEY ?? "",
  llmBaseUrl: (process.env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, ""),
  llmVisionModel: process.env.LLM_VISION_MODEL ?? "meta-llama/llama-4-scout",
  llmTextModel: process.env.LLM_TEXT_MODEL ?? "meta-llama/llama-3.3-70b-instruct",
  sam3ApiUrl: process.env.SAM3_API_URL ?? "",
  sam3ApiKey: process.env.SAM3_API_KEY ?? "",
};

export const aiMode = (): "live" | "mock" => (env.llmApiKey ? "live" : "mock");
