import { router } from "expo-router";
import { useRef, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { RecordingPresets, useAudioRecorder } from "expo-audio";
import { File } from "expo-file-system";
import { Orb } from "../components/Orb";
import { ACCENT, BigButton, BottomNav, ModeSwitch, Screen } from "../components/ui";
import { api, isUnauthorized } from "../lib/api";
import { ensureMicAccess } from "../lib/ambient";
import { useStrings } from "../lib/i18n";
import { announce } from "../lib/screenreader";
import { useBuddyStore } from "../lib/store";
import { speak, stopSpeaking } from "../lib/voice";

export default function Home() {
  const mode = useBuddyStore((s) => s.mode);
  const prefs = useBuddyStore((s) => s.prefs);
  const user = useBuddyStore((s) => s.user);
  const signOut = useBuddyStore((s) => s.signOut);
  const orbState = useBuddyStore((s) => s.orbState);
  const setOrbState = useBuddyStore((s) => s.setOrbState);
  const lastReply = useBuddyStore((s) => s.lastReply);
  const setLastReply = useBuddyStore((s) => s.setLastReply);
  const setMode = useBuddyStore((s) => s.setMode);
  const S = useStrings();

  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [talking, setTalking] = useState<"idle" | "recording" | "sending">("idle");
  const talkRecorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const history = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const accent = ACCENT[mode];
  const quickPhrases = mode === "visual" ? [S.qpVisual1, S.qpVisual2, S.qpVisual3, S.qpVisual4] : [S.qpHearing1, S.qpHearing2, S.qpHearing3, S.qpHearing4];

  /** Preguntas sobre sonidos rinden más en vivo: van directo a Escuchar. */
  const SOUND_RE = /escuch|sonido|ruido|alarma|sirena|timbre|bocina|dicen|hablan|gritan|llaman|o[ií]s|o[ií]r|listen|hear|sound|alarm|siren|doorbell|saying|someone/i;

  const deliver = (reply: string) => {
    setLastReply(reply);
    setExpanded(false);
    announce(reply); // TalkBack/VoiceOver lo lee aunque el TTS esté apagado
    if (mode === "visual") {
      setOrbState("speaking");
      speak(reply, prefs, () => setOrbState("idle"));
    } else {
      setOrbState("idle");
    }
  };

  const send = async (raw?: string) => {
    const message = (raw ?? input).trim();
    if (!message) return;
    // En modo escucha, lo referido a sonidos va directo a Escuchar en vivo:
    // subtítulos grandes + vibración le ganan a un párrafo de chat.
    if (mode === "hearing" && SOUND_RE.test(message)) {
      setInput("");
      setLastReply(S.homeToListen);
      router.push("/listen");
      return;
    }
    setInput("");
    stopSpeaking();
    setOrbState("thinking");
    try {
      const res = await api.chat(mode, message, history.current);
      history.current = [...history.current.slice(-8), { role: "user", content: message }, { role: "assistant", content: res.reply }];
      deliver(res.reply);
    } catch (e) {
      if (isUnauthorized(e)) {
        signOut();
        router.replace("/login");
        return;
      }
      deliver(mode === "visual" ? S.homeOfflineVisual : S.homeOfflineHearing);
    }
  };

  const onOrbTap = () => {
    if (orbState === "speaking") {
      stopSpeaking();
      setOrbState("idle");
      return;
    }
    setOrbState("listening");
    if (mode === "visual") speak(S.homeOrbListening, prefs, () => setOrbState("idle"));
    setTimeout(() => setOrbState("idle"), 1600);
  };

  const onOrbDoubleTap = () => router.push(mode === "visual" ? "/see" : "/listen");

  /** Voice commands (ES+EN): mode switch, go-to screens, SOS, repeat, settings. */
  const runVoiceCommand = (transcript: string): boolean => {
    const t = transcript.toLowerCase();
    if (/modo escucha|modo escuchar|listening mode|switch to listen/.test(t)) {
      setMode("hearing");
      deliver(S.homeCmdHearing);
      return true;
    }
    if (/\b(mir[aá]|ver|look|see)\b/.test(t)) {
      router.push("/see");
      return true;
    }
    if (/\b(escuchar|listen)\b/.test(t)) {
      router.push("/listen");
      return true;
    }
    if (/sos|socorro|emergencia|emergency|auxilio|help me/.test(t)) {
      sos();
      return true;
    }
    if (/repet[ií]|otra vez|repeat|again/.test(t)) {
      if (lastReply) speak(lastReply, prefs);
      else deliver(S.homeCmdNoReply);
      return true;
    }
    if (/ajustes|configuraci[oó]n|settings/.test(t)) {
      deliver(S.homeCmdSettings);
      router.push("/settings");
      return true;
    }
    if (/ayuda|help|qu[eé] pod[eé]s hacer|what can you/.test(t)) {
      deliver(S.homeCmdHelp);
      return true;
    }
    return false;
  };

  /** Mantené para hablar: graba, transcribe en el servidor y responde. */
  const talkStart = async () => {
    if (talking !== "idle") return;
    try {
      const ok = await ensureMicAccess();
      if (!ok) {
        deliver(S.talkFail);
        return;
      }
      await talkRecorder.prepareToRecordAsync();
      talkRecorder.record();
      setTalking("recording");
      setOrbState("listening");
    } catch {
      deliver(S.talkFail);
    }
  };

  const talkEnd = async () => {
    if (talking !== "recording") return;
    setTalking("sending");
    try {
      await talkRecorder.stop();
      const uri = talkRecorder.uri;
      if (!uri) throw new Error("no recording");
      const base64 = await new File(uri).base64();
      const res = await api.talk(base64, mode);
      if (mode === "visual" && runVoiceCommand(res.transcript)) return;
      history.current = [
        ...history.current.slice(-8),
        { role: "user", content: res.transcript || "(voz)" },
        { role: "assistant", content: res.reply },
      ];
      deliver(res.reply);
    } catch (e) {
      if (isUnauthorized(e)) {
        signOut();
        router.replace("/login");
        return;
      }
      deliver(S.talkFail);
    } finally {
      setTalking("idle");
    }
  };

  const sos = () => {
    const phone = prefs.emergencyPhone.trim();
    if (!phone) {
      Alert.alert(S.sosBtn, S.sosNoPhone, [
        { text: S.sosCancel, style: "cancel" },
        { text: S.sosGoSettings, onPress: () => router.push("/settings") },
      ]);
      return;
    }
    const who = prefs.emergencyName.trim();
    Alert.alert(S.sosTitle, `${S.sosMsg}${who ? ` ${who} (${phone})` : ` ${phone}`}`, [
      { text: S.sosCancel, style: "cancel" },
      { text: S.sosCall, style: "destructive", onPress: () => void Linking.openURL(`tel:${phone.replace(/\s/g, "")}`) },
    ]);
  };

  // BLIND HOME: 1 giant button + SOS. No menus, no lists, no nav.
  // Everything else (mirar, modo escucha, repetir, ajustes, SOS) is a voice command.
  if (mode === "visual") {
    return (
      <Screen>
        <View className="flex-1">
          <Text className="text-center text-2xl font-bold text-paper" accessibilityRole="header">
            {S.homeBlindTitle}
            {prefs.userName ? `, ${prefs.userName}` : ""}
          </Text>
          <View className="my-2 items-center">
            <Orb state={orbState} mode={mode} onTap={() => { stopSpeaking(); setOrbState("idle"); }} onDoubleTap={() => router.push("/see")} />
          </View>
          {lastReply ? (
            <Text className="mb-3 text-center text-3xl font-semibold leading-snug text-paper" accessibilityLiveRegion="polite">
              {lastReply}
            </Text>
          ) : null}
          <Pressable
            onPressIn={talkStart}
            onPressOut={talkEnd}
            disabled={talking === "sending"}
            accessibilityRole="button"
            accessibilityLabel={talking === "recording" ? S.talkListening : talking === "sending" ? S.talkSending : `${S.talkHold}. ${S.talkHoldHint}`}
            className="flex-1 items-center justify-center rounded-[32px] px-6"
            style={{ backgroundColor: talking === "recording" ? "#FF5468" : ACCENT.visual, minHeight: 300 }}
          >
            <Text className="text-center text-4xl font-bold leading-tight" style={{ color: "#060D14" }}>
              {talking === "recording" ? S.talkListening : talking === "sending" ? S.talkSending : `🎙\n${S.talkHold}`}
            </Text>
          </Pressable>
          <Pressable
            onPress={sos}
            accessibilityRole="button"
            accessibilityLabel={`${S.sosBtn}. ${S.sosBtnHint}`}
            className="mt-3 min-h-[88px] items-center justify-center rounded-[32px] border-2 border-[#FF5468] bg-[#3A1220] px-5 active:opacity-80"
          >
            <Text className="text-center text-3xl font-bold text-[#FF5468]">🆘 {S.sosBtn}</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
          <Text className="text-2xl font-bold text-paper" accessibilityRole="header">
            {S.homeHello}{prefs.userName ? `, ${prefs.userName}` : ""}
          </Text>
          <Text className="mb-3 mt-0.5 text-base text-muted">{user?.email ?? ""}</Text>
          <ModeSwitch />

          <View className="my-2">
            <Orb state={orbState} mode={mode} onTap={onOrbTap} onDoubleTap={onOrbDoubleTap} />
          </View>

          {lastReply ? (
            <View className="mb-4 rounded-3xl border border-line bg-panel p-4" accessibilityLiveRegion="polite">
              <Text className="mb-1 text-sm font-semibold" style={{ color: accent }}>
                {S.homeBuddySays}
              </Text>
              <Text className={mode === "hearing" ? (prefs.captionSize === "xlarge" ? "text-3xl font-semibold leading-snug text-paper" : "text-2xl leading-snug text-paper") : "text-xl leading-relaxed text-paper"}>
                {mode === "hearing" && !expanded && lastReply.length > 420 ? `${lastReply.slice(0, 420)}…` : lastReply}
              </Text>
              {mode === "hearing" && lastReply.length > 420 ? (
                <Pressable
                  onPress={() => setExpanded((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={expanded ? S.homeLess : S.homeMore}
                  className="mt-2 min-h-[48px] items-center justify-center rounded-2xl bg-panel2"
                >
                  <Text className="text-lg font-semibold text-paper">{expanded ? S.homeLess : S.homeMore}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View className="gap-3">
            <BigButton label={S.homeListenBtn} hint={S.homeListenHint} color={accent} onPress={() => router.push("/listen")} />
            <Pressable
              onPress={sos}
              accessibilityRole="button"
              accessibilityLabel={`${S.sosBtn}. ${S.sosBtnHint}`}
              accessibilityHint={S.sosBtnHint}
              className="min-h-[72px] items-center justify-center rounded-3xl border-2 border-[#FF5468] bg-[#3A1220] px-5 py-3 active:opacity-80"
            >
              <Text className="text-center text-2xl font-bold text-[#FF5468]">🆘 {S.sosBtn}</Text>
            </Pressable>

            <Pressable
              onPressIn={talkStart}
              onPressOut={talkEnd}
              disabled={talking === "sending"}
              accessibilityRole="button"
              accessibilityLabel={talking === "recording" ? S.talkListening : talking === "sending" ? S.talkSending : `${S.talkHold}. ${S.talkHoldHint}`}
              accessibilityHint={S.talkHoldHint}
              className="min-h-[72px] items-center justify-center rounded-3xl border-2 px-5 py-3 active:opacity-80"
              style={{
                backgroundColor: talking === "recording" ? "#FF5468" : "#0D1B29",
                borderColor: talking === "recording" ? "#FF5468" : accent,
              }}
            >
              <Text className="text-center text-xl font-bold" style={{ color: talking === "recording" ? "#060D14" : accent }}>
                {talking === "recording" ? S.talkListening : talking === "sending" ? S.talkSending : `🎙 ${S.talkHold}`}
              </Text>
            </Pressable>

            <View className="flex-row gap-2">
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={S.homeAskHearing}
                placeholderTextColor="#5E7A94"
                accessibilityLabel={S.homeMsgA11y}
                returnKeyType="send"
                onSubmitEditing={() => send()}
                className="min-h-[64px] flex-1 rounded-3xl border border-line bg-panel px-4 text-lg text-paper"
              />
              <Pressable
                onPress={() => send()}
                accessibilityRole="button"
                accessibilityLabel={S.homeTalkA11y}
                className="min-h-[64px] items-center justify-center rounded-3xl px-5"
                style={{ backgroundColor: accent }}
              >
                <Text className="text-lg font-bold text-ink">{S.homeTalk}</Text>
              </Pressable>
            </View>

            <Text className="text-base font-semibold text-muted">{S.homeQuick}</Text>
            <View className="flex-row flex-wrap gap-2">
              {quickPhrases.map((q) => (
                <Pressable
                  key={q}
                  onPress={() => send(q)}
                  accessibilityRole="button"
                  accessibilityLabel={q}
                  className="min-h-[52px] justify-center rounded-full border border-line bg-panel px-4 py-2"
                >
                  <Text className="text-base text-paper">{q}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      </Screen>
      <BottomNav />
    </>
  );
}
