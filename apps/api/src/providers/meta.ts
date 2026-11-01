import {
  DetectedObjectSchema,
  type AppLang,
  type ChatRequest,
  type DetectedObject,
  type ListenRequest,
  type ListenResponse,
  type SayRequest,
  type SayResponse,
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

const MOCK_SCENES_PT: typeof MOCK_SCENES = {
  default: {
    guidance: "O caminho à frente está quase livre. Há uma cadeira vazia 2 passos à frente à sua esquerda, e uma porta 5 passos à frente à sua direita. Ande em frente, levemente para a direita.",
    hazards: [],
    objects: [
      { label: "cadeira vazia", direction: "ahead-left", distanceSteps: 2, confidence: 0.94, isHazard: false, bbox: [0.08, 0.3, 0.3, 0.55] },
      { label: "porta", direction: "ahead-right", distanceSteps: 5, confidence: 0.91, isHazard: false, bbox: [0.62, 0.12, 0.3, 0.8] },
      { label: "mesa", direction: "right", distanceSteps: 3, confidence: 0.88, isHazard: false, bbox: [0.7, 0.45, 0.28, 0.4] },
    ],
  },
  crossing: {
    guidance: "Pare. Você está na beira da calçada, 1 passo à frente. O sinal de pedestres está vermelho. Um carro se aproxima pela sua esquerda. Espere até eu dizer que está livre.",
    hazards: ["calçada 1 passo à frente", "veículo se aproximando pela esquerda", "sinal vermelho para pedestres"],
    objects: [
      { label: "meio-fio", direction: "ahead", distanceSteps: 1, confidence: 0.97, isHazard: true, bbox: [0.1, 0.82, 0.8, 0.16] },
      { label: "sinal de pedestres (vermelho)", direction: "ahead-right", distanceSteps: 6, confidence: 0.9, isHazard: true, bbox: [0.66, 0.08, 0.12, 0.3] },
      { label: "carro", direction: "left", distanceSteps: 8, confidence: 0.93, isHazard: true, bbox: [0.0, 0.4, 0.3, 0.35] },
    ],
  },
  door: {
    guidance: "Há uma porta fechada 3 passos bem à frente. A maçaneta está do seu lado direito, na altura da cintura. Estenda a mão direita após 3 passos.",
    hazards: [],
    objects: [
      { label: "porta fechada", direction: "ahead", distanceSteps: 3, confidence: 0.96, isHazard: false, bbox: [0.3, 0.05, 0.4, 0.9] },
      { label: "maçaneta", direction: "ahead-right", distanceSteps: 3, confidence: 0.89, isHazard: false, bbox: [0.6, 0.48, 0.08, 0.1] },
    ],
  },
};

const MOCK_SCENES_FR: typeof MOCK_SCENES = {
  default: {
    guidance: "Le chemin devant vous est presque dégagé. Une chaise vide se trouve 2 pas devant à votre gauche, et une porte 5 pas devant à votre droite. Marchez tout droit, légèrement vers la droite.",
    hazards: [],
    objects: [
      { label: "chaise vide", direction: "ahead-left", distanceSteps: 2, confidence: 0.94, isHazard: false, bbox: [0.08, 0.3, 0.3, 0.55] },
      { label: "porte", direction: "ahead-right", distanceSteps: 5, confidence: 0.91, isHazard: false, bbox: [0.62, 0.12, 0.3, 0.8] },
      { label: "table", direction: "right", distanceSteps: 3, confidence: 0.88, isHazard: false, bbox: [0.7, 0.45, 0.28, 0.4] },
    ],
  },
  crossing: {
    guidance: "Arrêtez-vous. Vous êtes au bord du trottoir, 1 pas devant. Le feu piéton est rouge. Une voiture arrive par votre gauche. Attendez que je vous dise que c'est libre.",
    hazards: ["trottoir 1 pas devant", "véhicule arrivant par la gauche", "feu piéton rouge"],
    objects: [
      { label: "trottoir", direction: "ahead", distanceSteps: 1, confidence: 0.97, isHazard: true, bbox: [0.1, 0.82, 0.8, 0.16] },
      { label: "feu piéton (rouge)", direction: "ahead-right", distanceSteps: 6, confidence: 0.9, isHazard: true, bbox: [0.66, 0.08, 0.12, 0.3] },
      { label: "voiture", direction: "left", distanceSteps: 8, confidence: 0.93, isHazard: true, bbox: [0.0, 0.4, 0.3, 0.35] },
    ],
  },
  door: {
    guidance: "Il y a une porte fermée 3 pas droit devant. La poignée est à votre droite, à hauteur de taille. Tendez la main droite après 3 pas.",
    hazards: [],
    objects: [
      { label: "porte fermée", direction: "ahead", distanceSteps: 3, confidence: 0.96, isHazard: false, bbox: [0.3, 0.05, 0.4, 0.9] },
      { label: "poignée de porte", direction: "ahead-right", distanceSteps: 3, confidence: 0.89, isHazard: false, bbox: [0.6, 0.48, 0.08, 0.1] },
    ],
  },
};

const MOCK_SCENES_ALL: Record<AppLang, typeof MOCK_SCENES> = {
  en: MOCK_SCENES,
  es: MOCK_SCENES_ES,
  pt: MOCK_SCENES_PT,
  fr: MOCK_SCENES_FR,
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

const MOCK_LISTEN_ROTATION_PT: ListenResponse["events"][] = [
  [{ kind: "speech", label: "Fala próxima", caption: "“Com licença, seu trem para a Estação Central sai da plataforma 4 em cinco minutos.”", priority: "normal", confidence: 0.92 }],
  [{ kind: "doorbell", label: "Campainha", caption: "A campainha da porta da frente está tocando.", priority: "high", confidence: 0.95 }],
  [{ kind: "name-call", label: "Chamam você", caption: "Alguém atrás de você está dizendo seu nome.", priority: "high", confidence: 0.88 }],
  [
    { kind: "siren", label: "Sirene de emergência", caption: "Sirene de ambulância se aproximando pela sua esquerda. Fique longe da beira da rua.", priority: "critical", confidence: 0.97 },
    { kind: "horn", label: "Buzina", caption: "Uma buzina soou duas vezes, à frente e à direita.", priority: "high", confidence: 0.9 },
  ],
  [{ kind: "knock", label: "Batidas", caption: "Batidas numa porta próxima, à sua direita.", priority: "normal", confidence: 0.86 }],
  [{ kind: "silence", label: "Tudo quieto", caption: "Nenhum som importante agora. Tudo calmo ao redor.", priority: "low", confidence: 0.8 }],
];

const MOCK_LISTEN_ROTATION_FR: ListenResponse["events"][] = [
  [{ kind: "speech", label: "Paroles proches", caption: "« Pardon, votre train pour la Gare Centrale part du quai 4 dans cinq minutes. »", priority: "normal", confidence: 0.92 }],
  [{ kind: "doorbell", label: "Sonnette", caption: "On sonne à la porte d'entrée.", priority: "high", confidence: 0.95 }],
  [{ kind: "name-call", label: "On vous appelle", caption: "Quelqu'un derrière vous prononce votre nom.", priority: "high", confidence: 0.88 }],
  [
    { kind: "siren", label: "Sirène d'urgence", caption: "Sirène d'ambulance approchant par votre gauche. Éloignez-vous du bord de la route.", priority: "critical", confidence: 0.97 },
    { kind: "horn", label: "Klaxon", caption: "Un klaxon a retenti deux fois, devant à droite.", priority: "high", confidence: 0.9 },
  ],
  [{ kind: "knock", label: "Coups", caption: "On frappe à une porte proche, à votre droite.", priority: "normal", confidence: 0.86 }],
  [{ kind: "silence", label: "Tout est calme", caption: "Aucun son important pour l'instant. Tout est calme autour.", priority: "low", confidence: 0.8 }],
];

const MOCK_LISTEN_ALL: Record<AppLang, ListenResponse["events"][]> = {
  en: MOCK_LISTEN_ROTATION,
  es: MOCK_LISTEN_ROTATION_ES,
  pt: MOCK_LISTEN_ROTATION_PT,
  fr: MOCK_LISTEN_ROTATION_FR,
};

/** "Reply in X" suffix for live prompts so Llama answers in the user's language. */
const langLine = (lang: string): string =>
  lang === "es"
    ? "Reply entirely in Spanish (rioplatense, voseo). "
    : lang === "pt"
      ? "Reply entirely in Portuguese (Brazilian). "
      : lang === "fr"
        ? "Reply entirely in French. "
        : "Reply entirely in English. ";

// ------------------------------------------------------------------- routes
const CHAT_MOCK: Record<AppLang, Record<ChatRequest["mode"], (message: string) => string>> = {
  en: {
    visual: (m) => `I hear you. You said: “${m}”. Tap the big See For Me button or double-tap my orb and I will look through your camera and describe exactly where things are, in steps and directions.`,
    hearing: (m) => `Got it: “${m}”. I will keep captions large on screen and alert you with vibrations for doorbells, sirens, alarms, or someone calling your name.`,
  },
  es: {
    visual: (m) => `Te escucho. Dijiste: “${m}”. Tocá el botón grande Ver Por Mí o tocame dos veces y voy a mirar por la cámara y describirte dónde está cada cosa, en pasos y direcciones.`,
    hearing: (m) => `Entendido: “${m}”. Voy a mantener los subtítulos grandes y avisarte con vibraciones por timbres, sirenas, alarmas o si dicen tu nombre.`,
  },
  pt: {
    visual: (m) => `Te ouço. Você disse: “${m}”. Toque no botão grande Ver Por Mim ou toque duas vezes no meu orbe e vou olhar pela sua câmera e descrever exatamente onde está cada coisa, em passos e direções.`,
    hearing: (m) => `Entendi: “${m}”. Vou manter as legendas grandes na tela e avisar com vibrações sobre campainhas, sirenes, alarmes ou alguém dizendo seu nome.`,
  },
  fr: {
    visual: (m) => `Je vous entends. Vous avez dit : « ${m} ». Touchez le grand bouton Voir Pour Moi ou touchez mon orbe deux fois et je regarderai à travers votre caméra pour décrire exactement où se trouve chaque chose, en pas et en directions.`,
    hearing: (m) => `Compris : « ${m} ». Je garderai de grands sous-titres à l'écran et je vous préviendrai par vibrations pour les sonnettes, sirènes, alarmes, ou si quelqu'un prononce votre nom.`,
  },
};

export async function chatWithBuddy(req: ChatRequest): Promise<ProviderResult<{ reply: string }>> {
  if (aiMode() === "mock") {
    const reply = (CHAT_MOCK[req.lang] ?? CHAT_MOCK.en)[req.mode](req.message);
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

const SEE_FALLBACK: Record<AppLang, string> = {
  en: "I could not read the scene clearly. Please hold the phone steady and try again.",
  es: "No pude leer bien la escena. Sostené firme el teléfono e intentá de nuevo.",
  pt: "Não consegui ler bem a cena. Segure o celular firme e tente de novo.",
  fr: "Je n'ai pas bien lu la scène. Tenez le téléphone bien droit et réessayez.",
};

export async function analyzeScene(req: SeeRequest): Promise<ProviderResult<SeeResponse>> {
  if (aiMode() === "mock") {
    const q = req.question.toLowerCase();
    const scenes = MOCK_SCENES_ALL[req.lang] ?? MOCK_SCENES;
    const scene = /cross|street|safe|car|cruz|calle|seguro|auto|travess|rua|carro|atravessar|travers|sûr|rue|voiture|trottoir/.test(q)
      ? scenes.crossing
      : /door|exit|enter|puerta|salid|entr|porta|saída|entrar|porte|sortie/.test(q)
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
      guidance: typeof parsed?.guidance === "string" ? parsed.guidance : (SEE_FALLBACK[req.lang] ?? SEE_FALLBACK.en),
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

const TRANSCRIBE_BIAS: Record<AppLang, string[]> = {
  en: ["English", "Spanish"],
  es: ["Spanish", "English"],
  pt: ["Portuguese", "English"],
  fr: ["French", "English"],
};

/** Broad bias for ambient listen: source language is unknown, auto-detect it. */
const TRANSCRIBE_BIAS_ALL = ["English", "Spanish", "Portuguese", "French"];

async function metaTranscribe(wav: Buffer, hintLang?: string): Promise<string | null> {
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
            // Ambient listen passes no hint → all 4 languages, STT auto-detects
            // the source. Talk passes the UI lang (the user speaks to the buddy
            // in their own language) to sharpen accuracy.
            languageBias: hintLang ? (TRANSCRIBE_BIAS[hintLang as AppLang] ?? TRANSCRIBE_BIAS.en) : TRANSCRIBE_BIAS_ALL,
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

async function whisperTranscribe(raw: Buffer, hintLang?: string): Promise<string | null> {
  if (!env.llmApiKey) return null;
  try {
    const ext = isWav(raw) ? "wav" : "m4a";
    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from(raw)], { type: ext === "wav" ? "audio/wav" : "audio/mp4" }), `clip.${ext}`);
    form.append("model", env.llmSttModel);
    // `language` is a SOURCE hint, not a target: only send it when the caller
    // knows the speaker's language (talk). Ambient listen omits it so Whisper
    // auto-detects — the clip may be in any language regardless of UI lang.
    if (hintLang) form.append("language", hintLang);
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

/**
 * Transcribe + measure a mic clip. Null when no backend can process it.
 * `hintLang` is an optional SOURCE hint (talk: the user speaks UI lang).
 * Ambient listen omits it → STT auto-detects whatever language is spoken.
 */
async function analyzeAudio(audioBase64: string, hintLang?: string): Promise<HeardAudio | null> {
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
  if (useMeta() && wav) transcript = await metaTranscribe(wav, hintLang);
  if (!transcript && env.llmApiKey) transcript = await whisperTranscribe(raw, hintLang);
  if (!transcript && !energy) return null;
  return { transcript: transcript ?? "", peak: energy?.peak ?? 0, rms: energy?.rms ?? 0 };
}

const LANG_NAMES: Record<AppLang, string> = {
  en: "English",
  es: "Spanish (rioplatense, voseo)",
  pt: "Portuguese (Brazilian)",
  fr: "French",
};

/**
 * Translate ambient speech to the user's UI language. STT auto-detects the
 * source (any language); every caption the user reads must still be in
 * `targetLang`. Returns the original text on any failure (never throws).
 */
export async function translateToLang(text: string, targetLang: AppLang): Promise<ProviderResult<string>> {
  const target = LANG_NAMES[targetLang] ?? LANG_NAMES.en;
  const fallbackTokens = estimateTokens(text);
  try {
    const result = await llamaChat(
      [
        {
          role: "system",
          content: `You are a translator. Translate the user's text to ${target}. Return ONLY the translation, no quotes, no explanations. If it is already in ${target}, return it unchanged. Keep proper names unchanged.`,
        },
        { role: "user", content: text },
      ],
      false,
      // Reasoning models (Spark) share this budget between reasoning (~300
      // tok) and output: a tight cap starves the answer and yields "".
      1000,
      "low",
    );
    const out = result.data.trim().replace(/^["“«]+|["”»]+$/g, "").trim();
    if (!out) console.warn(`[translate] empty result for target ${targetLang}, keeping original`);
    return { data: out || text, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  } catch (err) {
    console.error(`[translate] to ${targetLang} failed:`, err instanceof Error ? err.message : err);
    return { data: text, inputTokens: fallbackTokens, outputTokens: 0 };
  }
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

const SPEECH_MOCK: Record<AppLang, ListenResponse["events"][number]> = {
  en: { kind: "speech", label: "Live caption", caption: "“Hi! The accessible entrance is just around the corner, on your right. Would you like a hand?”", priority: "normal", confidence: 0.93 },
  es: { kind: "speech", label: "Subtítulo en vivo", caption: "“¡Hola! La entrada accesible está a la vuelta, a tu derecha. ¿Querés que te ayude?”", priority: "normal", confidence: 0.93 },
  pt: { kind: "speech", label: "Legenda ao vivo", caption: "“Oi! A entrada acessível é logo ali na esquina, à sua direita. Quer uma ajuda?”", priority: "normal", confidence: 0.93 },
  fr: { kind: "speech", label: "Sous-titre en direct", caption: "« Bonjour ! L'entrée accessible est juste au coin, à votre droite. Voulez-vous un coup de main ? »", priority: "normal", confidence: 0.93 },
};

const NAME_CALL_MOCK: Record<AppLang, (name: string) => string> = {
  en: (n) => `Someone is calling: “${n}! Over here!”`,
  es: (n) => `Alguien te llama: “¡${n}! ¡Por acá!”`,
  pt: (n) => `Alguém está chamando: “${n}! Por aqui!”`,
  fr: (n) => `Quelqu'un appelle : « ${n} ! Par ici ! »`,
};

const LISTEN_LIVE: Record<
  AppLang,
  {
    silenceCaption: string;
    silenceLabel: string;
    noAudio: string;
    nameLabel: string;
    nameCaption: (transcript: string) => string;
    speechLabel: string;
    loudLabel: string;
    loudCaption: (pct: number) => string;
    noSpeech: string;
  }
> = {
  en: {
    silenceCaption: "Listening… no important sounds detected yet.",
    silenceLabel: "Listening",
    noAudio: "(no processable audio)",
    nameLabel: "Name call",
    nameCaption: (t) => `Someone says your name: “${t}”`,
    speechLabel: "Speech detected",
    loudLabel: "Loud sound",
    loudCaption: (pct) => `Loud sound detected (peak ${pct}%). It could be a doorbell, knock or alarm — check around.`,
    noSpeech: "No speech in this clip.",
  },
  es: {
    silenceCaption: "Escuchando… ningún sonido importante todavía.",
    silenceLabel: "Escuchando",
    noAudio: "(sin audio procesable)",
    nameLabel: "Te llaman",
    nameCaption: (t) => `Alguien dice tu nombre: “${t}”`,
    speechLabel: "Voz detectada",
    loudLabel: "Sonido fuerte",
    loudCaption: (pct) => `Sonido fuerte detectado (pico ${pct}%). Puede ser timbre, golpe o alarma — fijate alrededor.`,
    noSpeech: "No se escucha voz en este fragmento.",
  },
  pt: {
    silenceCaption: "Ouvindo… nenhum som importante ainda.",
    silenceLabel: "Ouvindo",
    noAudio: "(sem áudio processável)",
    nameLabel: "Chamam você",
    nameCaption: (t) => `Alguém diz seu nome: “${t}”`,
    speechLabel: "Fala detectada",
    loudLabel: "Som alto",
    loudCaption: (pct) => `Som alto detectado (pico ${pct}%). Pode ser campainha, batida ou alarme — olhe ao redor.`,
    noSpeech: "Nenhuma fala neste trecho.",
  },
  fr: {
    silenceCaption: "Écoute… aucun son important détecté.",
    silenceLabel: "Écoute",
    noAudio: "(aucun audio exploitable)",
    nameLabel: "On vous appelle",
    nameCaption: (t) => `Quelqu'un prononce votre nom : « ${t} »`,
    speechLabel: "Parole détectée",
    loudLabel: "Son fort",
    loudCaption: (pct) => `Son fort détecté (pic ${pct} %). Ce peut être une sonnette, un coup ou une alarme — regardez autour de vous.`,
    noSpeech: "Aucune parole dans cet extrait.",
  },
};

export async function listenAmbient(req: ListenRequest): Promise<ProviderResult<ListenResponse>> {
  const L = LISTEN_LIVE[req.lang] ?? LISTEN_LIVE.en;
  const audioBytes = req.audioBase64 ? Math.floor((req.audioBase64.length * 3) / 4) : 0;
  if (aiMode() === "mock") {
    // Phase 1 casi-streaming: client sends a ~3s clip per request (LOW_QUALITY
    // m4a, a few KB). Rotation is still scripted until a real classifier lands,
    // but timing is now driven by real mic clips instead of empty 5s polls.
    const rotation = MOCK_LISTEN_ALL[req.lang] ?? MOCK_LISTEN_ROTATION;
    const bucket = Math.floor(Date.now() / 3000) % rotation.length;
    let events = rotation[bucket];
    if (req.intent === "speech") {
      events = [SPEECH_MOCK[req.lang] ?? SPEECH_MOCK.en];
    } else if (req.userName) {
      const name = req.userName;
      const nameCaption = NAME_CALL_MOCK[req.lang] ?? NAME_CALL_MOCK.en;
      events = events.map((e) => (e.kind === "name-call" ? { ...e, caption: nameCaption(name) } : e));
    }
    return { data: { events }, inputTokens: 260 + Math.ceil(audioBytes / 100), outputTokens: 90 };
  }
  // Live path: REAL analysis — auto-detected STT transcript (any source
  // language) + measured loudness, then translated to the UI language so
  // every caption the user reads is in `req.lang` (en/es/pt/fr).
  // name mentioned → name-call · speech → translated caption · loud → loud ·
  // otherwise silence.
  const silenceCaption = L.silenceCaption;
  const silenceLabel = L.silenceLabel;
  const heard = req.audioBase64 ? await analyzeAudio(req.audioBase64) : null;
  if (!heard) {
    return {
      data: { events: [{ kind: "silence" as const, label: silenceLabel, caption: `${silenceCaption} ${L.noAudio}`, priority: "low" as const, confidence: 0.5 }] },
      inputTokens: 260 + Math.ceil(audioBytes / 100),
      outputTokens: 20,
    };
  }
  // Translate ambient speech to the UI lang (no-op when already matching).
  let captionText = heard.transcript;
  let tIn = 0;
  let tOut = 0;
  if (heard.transcript) {
    const t = await translateToLang(heard.transcript, req.lang);
    captionText = t.data;
    tIn = t.inputTokens;
    tOut = t.outputTokens;
    console.log(
      `[listen] lang=${req.lang} intent=${req.intent} stt=${JSON.stringify(heard.transcript.slice(0, 100))} → ${JSON.stringify(captionText.slice(0, 100))}`,
    );
  }
  const loud = heard.peak > 0.15 || heard.rms > 0.05;
  const events: ListenResponse["events"] = [];
  const nameHit =
    heard.transcript &&
    req.userName &&
    (mentionsName(heard.transcript, req.userName) || (captionText !== heard.transcript && mentionsName(captionText, req.userName)));
  if (nameHit) {
    events.push({
      kind: "name-call",
      label: L.nameLabel,
      caption: L.nameCaption(captionText),
      priority: "high",
      confidence: 0.82,
    });
  }
  if (heard.transcript) {
    events.push({
      kind: "speech",
      label: L.speechLabel,
      caption: `“${captionText}”`,
      priority: req.intent === "speech" ? "normal" : "normal",
      confidence: 0.86,
    });
  } else if (loud) {
    const pct = Math.round(heard.peak * 100);
    events.push({
      kind: "loud",
      label: L.loudLabel,
      caption: L.loudCaption(pct),
      priority: "high",
      confidence: 0.7,
    });
  }
  if (!events.length) {
    events.push({
      kind: "silence",
      label: silenceLabel,
      caption: req.intent === "speech" ? L.noSpeech : silenceCaption,
      priority: "low",
      confidence: 0.6,
    });
  }
  return {
    data: { events },
    inputTokens: 260 + Math.ceil(audioBytes / 100) + estimateTokens(heard.transcript) + tIn,
    outputTokens: 90 + tOut,
  };
}

const TALK_FALLBACK: Record<AppLang, string> = {
  en: "I didn't catch that. Hold the button and try again.",
  es: "No te escuché bien. Mantené el botón y hablá de nuevo.",
  pt: "Não ouvi bem. Segure o botão e fale de novo.",
  fr: "Je n'ai pas bien entendu. Maintenez le bouton et parlez à nouveau.",
};

/**
 * Say mode: translate typed text to the target language so the orb speaks the
 * translation (not the original with a mismatched voice). Mock mode has no
 * model, so it echoes the original and the client speaks it as-is.
 */
export async function sayTranslate(req: SayRequest): Promise<ProviderResult<SayResponse>> {
  if (aiMode() === "mock") {
    return {
      data: { text: req.text, targetLang: req.targetLang },
      inputTokens: estimateTokens(req.text),
      outputTokens: 0,
    };
  }
  const t = await translateToLang(req.text, req.targetLang);
  return {
    data: { text: t.data, targetLang: req.targetLang },
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
  };
}

/**
 * Hold-to-talk: transcribe the voice clip, then answer it as a chat message.
 * Unlike ambient listen (auto-detect), the STT source hint IS the UI lang —
 * the user speaks to the buddy in their own language — and the reply comes
 * back in `req.lang` via chatWithBuddy.
 */
export async function talkFromVoice(req: TalkRequest): Promise<ProviderResult<TalkResponse>> {
  const heard = await analyzeAudio(req.audioBase64, req.lang);
  const transcript = heard?.transcript ?? "";
  if (!transcript) {
    const reply = TALK_FALLBACK[req.lang] ?? TALK_FALLBACK.en;
    return { data: { transcript, reply, shouldSpeak: req.mode === "visual" }, inputTokens: 300, outputTokens: estimateTokens(reply) };
  }
  const chat = await chatWithBuddy({ mode: req.mode, message: transcript, history: [], lang: req.lang });
  return {
    data: { transcript, reply: chat.data.reply, shouldSpeak: req.mode === "visual" },
    inputTokens: chat.inputTokens + 300,
    outputTokens: chat.outputTokens + estimateTokens(transcript),
  };
}
