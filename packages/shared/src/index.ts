import { z } from "zod";

/** The first preference asked in onboarding. Drives the whole UX. */
export const ModeSchema = z.enum(["visual", "hearing"]);
export type Mode = z.infer<typeof ModeSchema>;

export const OrbStateSchema = z.enum(["idle", "listening", "thinking", "speaking", "alert"]);
export type OrbState = z.infer<typeof OrbStateSchema>;

export const DirectionSchema = z.enum(["left", "ahead-left", "ahead", "ahead-right", "right", "behind", "unknown"]);
export type Direction = z.infer<typeof DirectionSchema>;

export const DetectedObjectSchema = z.object({
  label: z.string(),
  direction: DirectionSchema,
  /** Estimated steps from the user, SAM 3 mask centroid + scale heuristic. */
  distanceSteps: z.number().min(0).max(50),
  confidence: z.number().min(0).max(1),
  isHazard: z.boolean().default(false),
  /** Normalized [x, y, w, h] from SAM 3 segmentation, when available. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});
export type DetectedObject = z.infer<typeof DetectedObjectSchema>;

export const ChatRequestSchema = z.object({
  mode: ModeSchema,
  message: z.string().min(1).max(2000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).max(12).default([]),
  /** UI language — server replies (mock + live prompts) in this language. */
  lang: z.enum(["es", "en"]).default("en"),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatResponseSchema = z.object({
  reply: z.string(),
  /** Visual mode: spoken by the buddy. Hearing mode: shown as large captions. */
  shouldSpeak: z.boolean(),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const SeeRequestSchema = z.object({
  mode: ModeSchema.default("visual"),
  question: z.string().max(500).default("What is in front of me?"),
  /** Base64 JPEG, downscaled client-side to <=720px wide before upload. */
  imageBase64: z.string().min(10).max(2_800_000),
  lang: z.enum(["es", "en"]).default("en"),
});
export type SeeRequest = z.infer<typeof SeeRequestSchema>;

export const SeeResponseSchema = z.object({
  /** Spatial, speakable guidance — never a vague scene description. */
  guidance: z.string(),
  objects: z.array(DetectedObjectSchema),
  hazards: z.array(z.string()),
  /** Which segmentation/reasoning path produced this result. */
  engine: z.enum(["sam3+llama", "llama-vision", "mock"]),
});
export type SeeResponse = z.infer<typeof SeeResponseSchema>;

export const SoundKindSchema = z.enum([
  "siren", "doorbell", "alarm", "name-call", "horn", "knock", "baby-cry", "dog-bark", "speech", "silence",
  /** Measured loud burst (ffmpeg RMS/peak) that STT could not attribute to speech. */
  "loud",
]);
export type SoundKind = z.infer<typeof SoundKindSchema>;

export const ListenRequestSchema = z.object({
  mode: ModeSchema.default("hearing"),
  /** `scan` = classify ambient sounds, `speech` = caption nearby speech. */
  intent: z.enum(["scan", "speech"]).default("scan"),
  /** Optional base64 audio clip (live mode); mock mode ignores it. */
  audioBase64: z.string().max(4_000_000).optional(),
  userName: z.string().max(60).optional(),
  lang: z.enum(["es", "en"]).default("en"),
});
export type ListenRequest = z.infer<typeof ListenRequestSchema>;

export const ListenEventSchema = z.object({
  kind: SoundKindSchema,
  label: z.string(),
  caption: z.string(),
  priority: z.enum(["low", "normal", "high", "critical"]),
  confidence: z.number().min(0).max(1),
});
export type ListenEvent = z.infer<typeof ListenEventSchema>;

export const ListenResponseSchema = z.object({ events: z.array(ListenEventSchema) });
export type ListenResponse = z.infer<typeof ListenResponseSchema>;

export const TalkRequestSchema = z.object({
  mode: ModeSchema.default("visual"),
  /** Base64 voice clip (m4a from the app, or wav). Transcribed server-side. */
  audioBase64: z.string().min(10).max(4_000_000),
  lang: z.enum(["es", "en"]).default("en"),
});
export type TalkRequest = z.infer<typeof TalkRequestSchema>;

export const TalkResponseSchema = z.object({
  transcript: z.string(),
  reply: z.string(),
  shouldSpeak: z.boolean(),
});
export type TalkResponse = z.infer<typeof TalkResponseSchema>;

/** Distinct vibration patterns so hearing-impaired users can tell alerts apart by touch. */
export const HAPTIC_PATTERNS: Record<string, number[]> = {
  critical: [0, 400, 100, 400, 100, 400], // siren / alarm: long triple buzz
  high: [0, 250, 80, 250], // doorbell / name call / loud sound: double buzz
  normal: [0, 120],
  low: [0, 60],
};

export const PRIORITY_SOUNDS: { kind: SoundKind; label: string }[] = [
  { kind: "siren", label: "Emergency siren" },
  { kind: "alarm", label: "Smoke / fire alarm" },
  { kind: "doorbell", label: "Doorbell" },
  { kind: "name-call", label: "Someone calling your name" },
  { kind: "horn", label: "Vehicle horn" },
  { kind: "knock", label: "Knocking at the door" },
  { kind: "baby-cry", label: "Baby crying" },
  { kind: "dog-bark", label: "Dog barking" },
];

/** Estimated upstream token cost per route, used for quota pre-checks. */
export const ROUTE_TOKEN_COST = { chat: 2000, see: 4500, listen: 1200, talk: 2500 } as const;

/** Free-tier daily budget per user (upstream tokens). Enforced server-side. */
export const DEFAULT_DAILY_TOKEN_BUDGET = 60_000;

export const QUICK_PHRASES: Record<Mode, string[]> = {
  visual: ["What is in front of me?", "Is there a door nearby?", "Read any text you can see", "Is it safe to cross?"],
  hearing: ["Caption what people are saying", "Listen for the doorbell", "Tell me if someone calls my name", "Any alarms or sirens?"],
};
