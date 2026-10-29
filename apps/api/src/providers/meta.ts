import {
  DetectedObjectSchema,
  type ChatRequest,
  type DetectedObject,
  type ListenRequest,
  type ListenResponse,
  type SeeRequest,
  type SeeResponse,
  type TalkRequest,
  type TalkResponse,
} from "@sense-buddy/shared";
import { aiMode, env, useMeta } from "../env";
import { estimateTokens } from "../lib/usage";
import { spawn } from "node:child_process";

export type ProviderResult<T> = { data: T; inputTokens: number; outputTokens: number };

/**
 * Model access layer.
 *
 * Two backends behind one interface (mobile never sees keys):
 * - Meta Model API (dev.meta.ai) when META_API_KEY/MODEL_API_KEY is set:
 *   Muse Spark via /chat/completions, SAM 3.1 via /responses,
 *   Voice Transcribe via /asr/transcribe. Base https://api.meta.ai/v1.
 * - OpenAI-compatible hosts (OpenRouter/Together/Groq) via LLM_* otherwise.
 */

type Msg = { role: string; content: unknown };

async function llamaChat(
  messages: Msg[],
  vision: boolean,
  maxTokens = 1500,
  effort: "low" | "medium" = "low",
): Promise<ProviderResult<string>> {
  const meta = useMeta();
  const model = meta ? (vision ? env.metaVisionModel : env.metaTextModel) : vision ? env.llmVisionModel : env.llmTextModel;
  // Muse Spark is a reasoning model: reasoning tokens share max_completion_tokens,
  // so budget generously and cap effort (dev.meta.ai/docs/protocols/chat-completions).
  // Temperature/top_p tweaks hurt Spark — leave them unset.
  const body: Record<string, unknown> = meta
    ? { model, messages, max_completion_tokens: maxTokens, reasoning_effort: effort }
    : { model, messages, max_tokens: maxTokens, temperature: 0.35 };
  const res = await fetch(`${meta ? env.metaBaseUrl : env.llmBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${meta ? env.metaApiKey : env.llmApiKey}` },
    body: JSON.stringify(body),
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
  // Prefer Meta SAM 3.1 (dev.meta.ai/docs/media-segmentation) when META_API_KEY
  // is set: POST {metaBaseUrl}/responses {model:"sam-3.1", input:[...]}.
  // Its output is special-token box+mask text needing client-lib parsing
  // (dev.meta.ai/docs/sam/reading-segmentation), so this returns null until
  // that parser lands — analyzeScene() already degrades to llama-vision.
  if (useMeta()) {
    try {
      const res = await fetch(`${env.metaBaseUrl}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.metaApiKey}` },
        body: JSON.stringify({
          model: env.metaSamModel,
          input: [
            {
              type: "message",
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                { type: "input_image", image_url: `data:image/jpeg;base64,${imageBase64}` },
              ],
            },
          ],
        }),
      });
      if (!res.ok) return null;
      // TODO: parse SAM 3.1 special-token output into DetectedObject[].
      return null;
    } catch {
      return null;
    }
  }
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

const MOCK_SCENES_ES: typeof MOCK_SCENES = {
  default: {
    guidance: "El camino está despejado. Hay una silla vacía 2 pasos adelante a tu izquierda, y una puerta 5 pasos adelante a tu derecha. Caminá derecho, apenas a la derecha.",
    hazards: [],
    objects: [
      { label: "silla vacía", direction: "ahead-left", distanceSteps: 2, confidence: 0.94, isHazard: false, bbox: [0.08, 0.3, 0.3, 0.55] },
      { label: "puerta", direction: "ahead-right", distanceSteps: 5, confidence: 0.91, isHazard: false, bbox: [0.62, 0.12, 0.3, 0.8] },
      { label: "mesa", direction: "right", distanceSteps: 3, confidence: 0.88, isHazard: false, bbox: [0.7, 0.45, 0.28, 0.4] },
    ],
  },
  crossing: {
    guidance: "Pará. Hay un cordón 1 paso adelante. El semáforo está en rojo. Viene un auto por tu izquierda. Esperá hasta que te diga que está libre.",
    hazards: ["cordón 1 paso adelante", "vehículo acercándose por la izquierda", "semáforo en rojo"],
    objects: [
      { label: "cordón", direction: "ahead", distanceSteps: 1, confidence: 0.97, isHazard: true, bbox: [0.1, 0.82, 0.8, 0.16] },
      { label: "semáforo en rojo", direction: "ahead-right", distanceSteps: 6, confidence: 0.9, isHazard: true, bbox: [0.66, 0.08, 0.12, 0.3] },
      { label: "auto", direction: "left", distanceSteps: 8, confidence: 0.93, isHazard: true, bbox: [0.0, 0.4, 0.3, 0.35] },
    ],
  },
  door: {
    guidance: "Hay una puerta cerrada 3 pasos justo adelante. El picaporte está a tu derecha, a la altura de la cintura. Estirá la mano derecha después de 3 pasos.",
    hazards: [],
    objects: [
      { label: "puerta cerrada", direction: "ahead", distanceSteps: 3, confidence: 0.96, isHazard: false, bbox: [0.3, 0.05, 0.4, 0.9] },
      { label: "picaporte", direction: "ahead-right", distanceSteps: 3, confidence: 0.89, isHazard: false, bbox: [0.6, 0.48, 0.08, 0.1] },
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

const MOCK_LISTEN_ROTATION_ES: ListenResponse["events"][] = [
  [{ kind: "speech", label: "Voz cercana", caption: "“Disculpá, tu tren a Retiro sale del andén 4 en cinco minutos.”", priority: "normal", confidence: 0.92 }],
  [{ kind: "doorbell", label: "Timbre", caption: "Están tocando el timbre de la puerta.", priority: "high", confidence: 0.95 }],
  [{ kind: "name-call", label: "Te llaman", caption: "Alguien detrás tuyo está diciendo tu nombre.", priority: "high", confidence: 0.88 }],
  [
    { kind: "siren", label: "Sirena de emergencia", caption: "Sirena de ambulancia acercándose por tu izquierda. Alejate del borde de la calle.", priority: "critical", confidence: 0.97 },
    { kind: "horn", label: "Bocina", caption: "Una bocina sonó dos veces, adelante a la derecha.", priority: "high", confidence: 0.9 },
  ],
  [{ kind: "knock", label: "Golpes", caption: "Están golpeando una puerta cerca, a tu derecha.", priority: "normal", confidence: 0.86 }],
  [{ kind: "silence", label: "Todo tranquilo", caption: "Ningún sonido importante ahora. Todo calmo alrededor.", priority: "low", confidence: 0.8 }],
];

/** "Reply in X" suffix for live prompts so Llama answers in the user's language. */
const langLine = (lang: string): string =>
  lang === "es" ? "Reply entirely in Spanish (rioplatense, voseo). " : "Reply entirely in English. ";

// ------------------------------------------------------------------- routes
export async function chatWithBuddy(req: ChatRequest): Promise<ProviderResult<{ reply: string }>> {
  const es = req.lang === "es";
  if (aiMode() === "mock") {
    const reply = es
      ? req.mode === "visual"
        ? `Te escucho. Dijiste: “${req.message}”. Tocá el botón grande Ver Por Mí o tocame dos veces y voy a mirar por la cámara y describirte dónde está cada cosa, en pasos y direcciones.`
        : `Entendido: “${req.message}”. Voy a mantener los subtítulos grandes y avisarte con vibraciones por timbres, sirenas, alarmas o si dicen tu nombre.`
      : req.mode === "visual"
        ? `I hear you. You said: “${req.message}”. Tap the big See For Me button or double-tap my orb and I will look through your camera and describe exactly where things are, in steps and directions.`
        : `Got it: “${req.message}”. I will keep captions large on screen and alert you with vibrations for doorbells, sirens, alarms, or someone calling your name.`;
    return { data: { reply }, inputTokens: estimateTokens(req.message), outputTokens: estimateTokens(reply) };
  }
  const system =
    req.mode === "visual"
      ? `${langLine(req.lang)}You are Sense Buddy, a warm voice assistant for a blind user. Answer in short spoken sentences. Give spatial guidance in steps and clock/left-right directions. Never say 'as an AI'.`
      : `${langLine(req.lang)}You are Sense Buddy, an assistant for a deaf user. Answer as short, clear captions. Flag important environmental sounds. Keep each line under 90 characters when possible.`;
  const result = await llamaChat(
    [{ role: "system", content: system }, ...req.history, { role: "user", content: req.message }],
    false,
    1500,
    "low",
  );
  return { data: { reply: result.data }, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}

export async function analyzeScene(req: SeeRequest): Promise<ProviderResult<SeeResponse>> {
  const es = req.lang === "es";
  if (aiMode() === "mock") {
    const q = req.question.toLowerCase();
    const scenes = es ? MOCK_SCENES_ES : MOCK_SCENES;
    const scene = /cross|street|safe|car|cruz|calle|seguro|auto/.test(q)
      ? scenes.crossing
      : /door|exit|enter|puerta|salid|entr/.test(q)
        ? scenes.door
        : scenes.default;
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
            text: `${langLine(req.lang)}You guide a blind person. Question: "${req.question}". ${segmentContext}
Reply ONLY with JSON: {"guidance":"<spatial spoken guidance in steps and left/ahead/right, hazards first, max 45 words>","objects":[{"label":"","direction":"left|ahead-left|ahead|ahead-right|right","distanceSteps":0,"confidence":0.0,"isHazard":false}],"hazards":[""]}`,
          },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${req.imageBase64}` } },
        ],
      },
    ],
    true,
    2000,
    "medium",
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
      guidance: typeof parsed?.guidance === "string" ? parsed.guidance : es ? "No pude leer bien la escena. Sostené firme el teléfono e intentá de nuevo." : "I could not read the scene clearly. Please hold the phone steady and try again.",
      objects: merged,
      hazards: Array.isArray(parsed?.hazards) ? (parsed.hazards as string[]) : merged.filter((o) => o.isHazard).map((o) => o.label),
      engine: segments?.length ? "sam3+llama" : "llama-vision",
    },
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

/**
 * Real audio pipeline (STT + loudness). All mic audio flows through here.
 *
 * Two STT backends:
 * - Meta Voice Transcribe (dev.meta.ai/docs/speech-to-text) when META_API_KEY
 *   is set: POST /asr/transcribe, WAV mono 16-bit only.
 * - OpenAI-compatible /audio/transcriptions (whisper, accepts m4a/mp3/wav)
 *   through the generic LLM_* backend (Groq default).
 *
 * ffmpeg, when installed on the server, converts m4a to WAV and powers the
 * loudness detector (peak/RMS on PCM). A loud burst with no speech becomes a
 * real `loud` event — specific labels (siren vs doorbell) still need an
 * on-device classifier (phase 3, YAMNet). Everything degrades to null.
 */
const isWav = (b: Buffer): boolean =>
  b.length > 44 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE";

let ffmpegOk: boolean | null = null;
function runFfmpeg(args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { timeout: 20000 });
    const chunks: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      if (Buffer.concat(chunks).length < 24 * 1024 * 1024) chunks.push(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exit ${code}: ${err.slice(0, 300)}`))));
    if (input?.length) child.stdin.write(input);
    child.stdin.end();
  });
}
async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegOk !== null) return ffmpegOk;
  try {
    await runFfmpeg(["-version"]);
    ffmpegOk = true;
  } catch {
    ffmpegOk = false;
  }
  return ffmpegOk;
}

/** m4a/3gp to 16kHz mono WAV for Meta STT + energy analysis. Null if impossible. */
async function toWav16k(input: Buffer): Promise<Buffer | null> {
  if (isWav(input)) return input;
  if (!(await hasFfmpeg())) return null;
  try {
    return await runFfmpeg(
      ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"],
      input,
    );
  } catch {
    return null;
  }
}

/** Peak/RMS loudness from a WAV buffer (0..1). Null when unparseable. */
function wavEnergy(wav: Buffer): { peak: number; rms: number } | null {
  const dataIdx = wav.indexOf(Buffer.from("data"));
  if (dataIdx < 0) return null;
  let peak = 0;
  let sum = 0;
  let n = 0;
  for (let i = dataIdx + 8; i + 1 < wav.length; i += 2) {
    const s = wav.readInt16LE(i) / 32768;
    const a = Math.abs(s);
    if (a > peak) peak = a;
    sum += s * s;
    n++;
  }
  if (!n) return null;
  return { peak, rms: Math.sqrt(sum / n) };
}

async function metaTranscribe(wav: Buffer, lang: string): Promise<string | null> {
  try {
    const form = new FormData();
    // The `request` part must be typed as JSON (per the Meta docs' curl):
    // a bare string part goes out as text/plain and risks a 400.
    form.append(
      "request",
      new Blob(
        [
          JSON.stringify({
            mode: "ENDPOINTING",
            model: env.metaAsrModel,
            audioEncoding: "WAV",
            languageBias: lang === "es" ? ["Spanish", "English"] : ["English", "Spanish"],
          }),
        ],
        { type: "application/json" },
      ),
    );
    form.append("audio", new Blob([Uint8Array.from(wav)], { type: "audio/wav" }), "clip.wav");
    const res = await fetch(`${env.metaBaseUrl}/asr/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.metaApiKey}` },
      body: form,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { transcript?: string };
    return typeof json.transcript === "string" && json.transcript.trim() ? json.transcript.trim() : null;
  } catch {
    return null;
  }
}

async function whisperTranscribe(raw: Buffer, lang: string): Promise<string | null> {
  if (!env.llmApiKey) return null;
  try {
    const ext = isWav(raw) ? "wav" : "m4a";
    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from(raw)], { type: ext === "wav" ? "audio/wav" : "audio/mp4" }), `clip.${ext}`);
    form.append("model", env.llmSttModel);
    form.append("language", lang);
    const res = await fetch(`${env.llmBaseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.llmApiKey}` },
      body: form,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { text?: string };
    return typeof json.text === "string" && json.text.trim() ? json.text.trim() : null;
  } catch {
    return null;
  }
}

export type HeardAudio = { transcript: string; peak: number; rms: number };

/** Transcribe + measure a mic clip. Null when no backend can process it. */
async function analyzeAudio(audioBase64: string, lang: string): Promise<HeardAudio | null> {
  let raw: Buffer;
  try {
    raw = Buffer.from(audioBase64, "base64");
  } catch {
    return null;
  }
  if (raw.length < 200) return null;
  const wav = await toWav16k(raw);
  const energy = wav ? wavEnergy(wav) : null;

  let transcript: string | null = null;
  if (useMeta() && wav) transcript = await metaTranscribe(wav, lang);
  if (!transcript && env.llmApiKey) transcript = await whisperTranscribe(raw, lang);
  if (!transcript && !energy) return null;
  return { transcript: transcript ?? "", peak: energy?.peak ?? 0, rms: energy?.rms ?? 0 };
}

const norm = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** True when the transcript mentions the user's name (any word, accent-insensitive). */
function mentionsName(transcript: string, userName: string): boolean {
  const t = norm(transcript);
  return norm(userName)
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .some((w) => t.includes(w));
}

export async function listenAmbient(req: ListenRequest): Promise<ProviderResult<ListenResponse>> {
  const es = req.lang === "es";
  const audioBytes = req.audioBase64 ? Math.floor((req.audioBase64.length * 3) / 4) : 0;
  if (aiMode() === "mock") {
    // Phase 1 casi-streaming: client sends a ~3s clip per request (LOW_QUALITY
    // m4a, a few KB). Rotation is still scripted until a real classifier lands,
    // but timing is now driven by real mic clips instead of empty 5s polls.
    const rotation = es ? MOCK_LISTEN_ROTATION_ES : MOCK_LISTEN_ROTATION;
    const bucket = Math.floor(Date.now() / 3000) % rotation.length;
    let events = rotation[bucket];
    if (req.intent === "speech") {
      events = es
        ? [{ kind: "speech", label: "Subtítulo en vivo", caption: "“¡Hola! La entrada accesible está a la vuelta, a tu derecha. ¿Querés que te ayude?”", priority: "normal", confidence: 0.93 }]
        : [{ kind: "speech", label: "Live caption", caption: "“Hi! The accessible entrance is just around the corner, on your right. Would you like a hand?”", priority: "normal", confidence: 0.93 }];
    } else if (req.userName) {
      events = events.map((e) =>
        e.kind === "name-call"
          ? { ...e, caption: es ? `Alguien te llama: “¡${req.userName}! ¡Por acá!”` : `Someone is calling: “${req.userName}! Over here!”` }
          : e,
      );
    }
    return { data: { events }, inputTokens: 260 + Math.ceil(audioBytes / 100), outputTokens: 90 };
  }
  // Live path: REAL analysis — STT transcript + measured loudness, no LLM call.
  // Deterministic mapping keeps it fast and cheap per 3s clip:
  // name mentioned → name-call · speech → real caption · loud burst → loud ·
  // otherwise silence. Speech/silence labels below are for the fallback only.
  const silenceCaption = es ? "Escuchando… ningún sonido importante todavía." : "Listening… no important sounds detected yet.";
  const silenceLabel = es ? "Escuchando" : "Listening";
  const heard = req.audioBase64 ? await analyzeAudio(req.audioBase64, req.lang) : null;
  if (!heard) {
    return {
      data: { events: [{ kind: "silence" as const, label: silenceLabel, caption: es ? `${silenceCaption} (sin audio procesable)` : `${silenceCaption} (no processable audio)`, priority: "low" as const, confidence: 0.5 }] },
      inputTokens: 260 + Math.ceil(audioBytes / 100),
      outputTokens: 20,
    };
  }
  const loud = heard.peak > 0.15 || heard.rms > 0.05;
  const events: ListenResponse["events"] = [];
  if (heard.transcript && req.userName && mentionsName(heard.transcript, req.userName)) {
    events.push({
      kind: "name-call",
      label: es ? "Te llaman" : "Name call",
      caption: es ? `Alguien dice tu nombre: “${heard.transcript}”` : `Someone says your name: “${heard.transcript}”`,
      priority: "high",
      confidence: 0.82,
    });
  }
  if (heard.transcript) {
    events.push({
      kind: "speech",
      label: es ? "Voz detectada" : "Speech detected",
      caption: `“${heard.transcript}”`,
      priority: req.intent === "speech" ? "normal" : "normal",
      confidence: 0.86,
    });
  } else if (loud) {
    const pct = Math.round(heard.peak * 100);
    events.push({
      kind: "loud",
      label: es ? "Sonido fuerte" : "Loud sound",
      caption: es
        ? `Sonido fuerte detectado (pico ${pct}%). Puede ser timbre, golpe o alarma — fijate alrededor.`
        : `Loud sound detected (peak ${pct}%). It could be a doorbell, knock or alarm — check around.`,
      priority: "high",
      confidence: 0.7,
    });
  }
  if (!events.length) {
    events.push({
      kind: "silence",
      label: silenceLabel,
      caption: req.intent === "speech" ? (es ? "No se escucha voz en este fragmento." : "No speech in this clip.") : silenceCaption,
      priority: "low",
      confidence: 0.6,
    });
  }
  return { data: { events }, inputTokens: 260 + Math.ceil(audioBytes / 100) + estimateTokens(heard.transcript), outputTokens: 90 };
}

/** Hold-to-talk: transcribe the voice clip, then answer it as a chat message. */
export async function talkFromVoice(req: TalkRequest): Promise<ProviderResult<TalkResponse>> {
  const es = req.lang === "es";
  const heard = await analyzeAudio(req.audioBase64, req.lang);
  const transcript = heard?.transcript ?? "";
  if (!transcript) {
    const reply = es ? "No te escuché bien. Mantené el botón y hablá de nuevo." : "I didn't catch that. Hold the button and try again.";
    return { data: { transcript, reply, shouldSpeak: req.mode === "visual" }, inputTokens: 300, outputTokens: estimateTokens(reply) };
  }
  const chat = await chatWithBuddy({ mode: req.mode, message: transcript, history: [], lang: req.lang });
  return {
    data: { transcript, reply: chat.data.reply, shouldSpeak: req.mode === "visual" },
    inputTokens: chat.inputTokens + 300,
    outputTokens: chat.outputTokens + estimateTokens(transcript),
  };
}
