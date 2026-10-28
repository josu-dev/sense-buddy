import {
  DetectedObjectSchema,
  type ChatRequest,
  type DetectedObject,
  type ListenRequest,
  type ListenResponse,
  type SeeRequest,
  type SeeResponse,
} from "@sense-buddy/shared";
import { aiMode, env } from "../env";
import { estimateTokens } from "../lib/usage";

export type ProviderResult<T> = { data: T; inputTokens: number; outputTokens: number };

/**
 * Meta-model access layer.
 *
 * Reality check: Meta does not sell a hosted "Meta API" for Llama / SAM 3.
 * Llama 4 (vision) and Llama 3.3 are served through OpenAI-compatible hosts
 * (OpenRouter, Together, Groq, Fireworks) and SAM 3 through model hosts
 * (Replicate, fal.ai, HF Inference, self-hosted). This module hides both
 * behind one interface, so the mobile client only ever talks to us and
 * provider keys never leave the server.
 */

type Msg = { role: string; content: unknown };

async function llamaChat(messages: Msg[], vision: boolean, maxTokens = 600): Promise<ProviderResult<string>> {
  const res = await fetch(`${env.llmBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.llmApiKey}` },
    body: JSON.stringify({
      model: vision ? env.llmVisionModel : env.llmTextModel,
      messages,
      max_tokens: maxTokens,
      temperature: 0.35,
    }),
  });
  if (!res.ok) throw new Error(`LLM provider ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  return {
    data: content,
    inputTokens: json.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages)),
    outputTokens: json.usage?.completion_tokens ?? estimateTokens(content),
  };
}

const directionFromBbox = (bbox: [number, number, number, number]): DetectedObject["direction"] => {
  const cx = bbox[0] + bbox[2] / 2;
  if (cx < 0.28) return "left";
  if (cx < 0.42) return "ahead-left";
  if (cx <= 0.58) return "ahead";
  if (cx <= 0.72) return "ahead-right";
  return "right";
};

/** SAM 3: zero-shot segmentation from text prompts. Returns null if not configured/failed. */
async function sam3Segment(imageBase64: string, prompt: string): Promise<DetectedObject[] | null> {
  if (!env.sam3ApiUrl) return null;
  try {
    const res = await fetch(env.sam3ApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(env.sam3ApiKey ? { Authorization: `Bearer ${env.sam3ApiKey}` } : {}) },
      body: JSON.stringify({ image: `data:image/jpeg;base64,${imageBase64}`, prompt }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { objects?: { label?: string; bbox?: number[]; confidence?: number }[] };
    if (!Array.isArray(json.objects)) return null;
    return json.objects.flatMap((o) => {
      if (!o.label || !o.bbox || o.bbox.length !== 4) return [];
      const bbox = o.bbox.map((v) => Math.min(1, Math.max(0, v > 1.5 ? v / 1000 : v))) as [number, number, number, number];
      const parsed = DetectedObjectSchema.safeParse({
        label: o.label,
        bbox,
        direction: directionFromBbox(bbox),
        distanceSteps: Math.min(12, Math.max(1, Math.round((1 - bbox[3]) * 8))),
        confidence: o.confidence ?? 0.8,
        isHazard: /car|vehicle|stairs|obstacle|bicycle|crosswalk/i.test(o.label),
      });
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return null;
  }
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- mock data
const MOCK_SCENES: Record<string, { guidance: string; objects: DetectedObject[]; hazards: string[] }> = {
  default: {
    guidance: "Path ahead is mostly clear. An empty chair is 2 steps ahead to your left, and a doorway is 5 steps ahead to your right. Walk straight, slightly right.",
    hazards: [],
    objects: [
      { label: "empty chair", direction: "ahead-left", distanceSteps: 2, confidence: 0.94, isHazard: false, bbox: [0.08, 0.3, 0.3, 0.55] },
      { label: "doorway", direction: "ahead-right", distanceSteps: 5, confidence: 0.91, isHazard: false, bbox: [0.62, 0.12, 0.3, 0.8] },
      { label: "table", direction: "right", distanceSteps: 3, confidence: 0.88, isHazard: false, bbox: [0.7, 0.45, 0.28, 0.4] },
    ],
  },
  crossing: {
    guidance: "Stop. You are at a curb, 1 step ahead. The crosswalk signal is red. A car is approaching from your left. Wait until I say it is clear.",
    hazards: ["curb 1 step ahead", "vehicle approaching from the left", "red crossing signal"],
    objects: [
      { label: "curb", direction: "ahead", distanceSteps: 1, confidence: 0.97, isHazard: true, bbox: [0.1, 0.82, 0.8, 0.16] },
      { label: "crosswalk signal (red)", direction: "ahead-right", distanceSteps: 6, confidence: 0.9, isHazard: true, bbox: [0.66, 0.08, 0.12, 0.3] },
      { label: "car", direction: "left", distanceSteps: 8, confidence: 0.93, isHazard: true, bbox: [0.0, 0.4, 0.3, 0.35] },
    ],
  },
  door: {
    guidance: "There is a closed door 3 steps directly ahead. The handle is on your right side, about waist height. Reach forward with your right hand after 3 steps.",
    hazards: [],
    objects: [
      { label: "closed door", direction: "ahead", distanceSteps: 3, confidence: 0.96, isHazard: false, bbox: [0.3, 0.05, 0.4, 0.9] },
      { label: "door handle", direction: "ahead-right", distanceSteps: 3, confidence: 0.89, isHazard: false, bbox: [0.6, 0.48, 0.08, 0.1] },
    ],
  },
};

const MOCK_LISTEN_ROTATION: ListenResponse["events"][] = [
  [{ kind: "speech", label: "Nearby speech", caption: "“Excuse me, your train to Central Station leaves from platform 4 in five minutes.”", priority: "normal", confidence: 0.92 }],
  [{ kind: "doorbell", label: "Doorbell", caption: "Doorbell ringing at the front door.", priority: "high", confidence: 0.95 }],
  [{ kind: "name-call", label: "Name call", caption: "Someone behind you is calling your name.", priority: "high", confidence: 0.88 }],
  [
    { kind: "siren", label: "Emergency siren", caption: "Ambulance siren approaching from your left. Stay clear of the road edge.", priority: "critical", confidence: 0.97 },
    { kind: "horn", label: "Vehicle horn", caption: "A car horn sounded twice, ahead-right.", priority: "high", confidence: 0.9 },
  ],
  [{ kind: "knock", label: "Knocking", caption: "Knocking at a door nearby, to your right.", priority: "normal", confidence: 0.86 }],
  [{ kind: "silence", label: "All quiet", caption: "No important sounds right now. Your surroundings sound calm.", priority: "low", confidence: 0.8 }],
];

// ------------------------------------------------------------------- routes
export async function chatWithBuddy(req: ChatRequest): Promise<ProviderResult<{ reply: string }>> {
  if (aiMode() === "mock") {
    const reply =
      req.mode === "visual"
        ? `I hear you. You said: “${req.message}”. Tap the big See For Me button or double-tap my orb and I will look through your camera and describe exactly where things are, in steps and directions.`
        : `Got it: “${req.message}”. I will keep captions large on screen and alert you with vibrations for doorbells, sirens, alarms, or someone calling your name.`;
    return { data: { reply }, inputTokens: estimateTokens(req.message), outputTokens: estimateTokens(reply) };
  }
  const system =
    req.mode === "visual"
      ? "You are Sense Buddy, a warm voice assistant for a blind user. Answer in short spoken sentences. Give spatial guidance in steps and clock/left-right directions. Never say 'as an AI'."
      : "You are Sense Buddy, an assistant for a deaf user. Answer as short, clear captions. Flag important environmental sounds. Keep each line under 90 characters when possible.";
  const result = await llamaChat(
    [{ role: "system", content: system }, ...req.history, { role: "user", content: req.message }],
    false,
  );
  return { data: { reply: result.data }, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}

export async function analyzeScene(req: SeeRequest): Promise<ProviderResult<SeeResponse>> {
  if (aiMode() === "mock") {
    const q = req.question.toLowerCase();
    const scene = /cross|street|safe|car/.test(q) ? MOCK_SCENES.crossing : /door|exit|enter/.test(q) ? MOCK_SCENES.door : MOCK_SCENES.default;
    return { data: { ...scene, engine: "mock" }, inputTokens: 1400, outputTokens: 220 };
  }

  const segments = await sam3Segment(req.imageBase64, "obstacles, doorways, chairs, people, vehicles, crosswalk signals, stairs, text signs");
  const segmentContext = segments?.length
    ? `SAM 3 segmented these objects (label, direction, steps): ${segments.map((s) => `${s.label} ${s.direction} ${s.distanceSteps} steps`).join("; ")}.`
    : "No segmentation available; ground objects from the image yourself.";

  const result = await llamaChat(
    [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You guide a blind person. Question: "${req.question}". ${segmentContext}
Reply ONLY with JSON: {"guidance":"<spatial spoken guidance in steps and left/ahead/right, hazards first, max 45 words>","objects":[{"label":"","direction":"left|ahead-left|ahead|ahead-right|right","distanceSteps":0,"confidence":0.0,"isHazard":false}],"hazards":[""]}`,
          },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${req.imageBase64}` } },
        ],
      },
    ],
    true,
    700,
  );
  const parsed = parseJsonObject(result.data);
  const objects = Array.isArray(parsed?.objects)
    ? (parsed.objects as unknown[]).flatMap((o) => {
        const p = DetectedObjectSchema.omit({ bbox: true }).safeParse(o);
        return p.success ? [p.data] : [];
      })
    : (segments ?? []);
  const merged = segments?.length ? segments : objects;
  return {
    data: {
      guidance: typeof parsed?.guidance === "string" ? parsed.guidance : "I could not read the scene clearly. Please hold the phone steady and try again.",
      objects: merged,
      hazards: Array.isArray(parsed?.hazards) ? (parsed.hazards as string[]) : merged.filter((o) => o.isHazard).map((o) => o.label),
      engine: segments?.length ? "sam3+llama" : "llama-vision",
    },
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

export async function listenAmbient(req: ListenRequest): Promise<ProviderResult<ListenResponse>> {
  if (aiMode() === "mock") {
    const bucket = Math.floor(Date.now() / 5000) % MOCK_LISTEN_ROTATION.length;
    let events = MOCK_LISTEN_ROTATION[bucket];
    if (req.intent === "speech") {
      events = [{ kind: "speech", label: "Live caption", caption: "“Hi! The accessible entrance is just around the corner, on your right. Would you like a hand?”", priority: "normal", confidence: 0.93 }];
    } else if (req.userName) {
      events = events.map((e) => (e.kind === "name-call" ? { ...e, caption: `Someone is calling: “${req.userName}! Over here!”` } : e));
    }
    return { data: { events }, inputTokens: 260, outputTokens: 90 };
  }
  // Live path: caption/classify with the vision-language model when an audio
  // transcript is supplied by the client; full audio classification plugs in
  // here behind the same response shape.
  const result = await llamaChat(
    [
      {
        role: "user",
        content: `A deaf user asked you to ${req.intent === "speech" ? "caption nearby speech" : "listen for important sounds (siren, alarm, doorbell, their name being called, horn)"}. Their name is ${req.userName ?? "unknown"}. No audio transcript was provided, so reply ONLY with JSON {"events":[{"kind":"silence","label":"Listening","caption":"Listening… no important sounds detected yet.","priority":"low","confidence":0.5}]}`,
      },
    ],
    false,
    300,
  );
  const parsed = parseJsonObject(result.data);
  const events = (parsed?.events as ListenResponse["events"] | undefined) ?? [
    { kind: "silence" as const, label: "Listening", caption: "Listening… no important sounds detected yet.", priority: "low" as const, confidence: 0.5 },
  ];
  return { data: { events }, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}
