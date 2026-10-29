import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { File } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStrings } from "./i18n";

const CLIP_MS = 3000;

/** Request mic permission + audio session. Returns true when recording is possible. */
export async function ensureMicAccess(): Promise<boolean> {
  try {
    const status = await AudioModule.requestRecordingPermissionsAsync();
    if (!status.granted) return false;
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Phase 1 casi-streaming: records short clips in a loop and hands each
 * base64 clip to `onClip`. Single-recorder loop, so there is a small gap
 * (~200-400ms stop/prepare) between clips — far better than the old 5s
 * polling with no audio, and a stepping stone to Phase 2 WS PCM streaming
 * (`useAudioStream`) with zero gaps.
 */
export function useAmbientClips(onClip: (audioBase64: string | undefined, clipIndex: number) => Promise<void>) {
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const S = useStrings();
  const alive = useRef(false);
  const [clipCount, setClipCount] = useState(0);
  const [micError, setMicError] = useState("");
  const handler = useRef(onClip);
  useEffect(() => {
    handler.current = onClip;
  }, [onClip]);

  const start = useCallback(async (): Promise<boolean> => {
    if (alive.current) return true;
    const ok = await ensureMicAccess();
    if (!ok) {
      setMicError(S.listenMicBlocked);
      alive.current = true;
      let n = 0;
      void (async () => {
        while (alive.current) {
          try {
            await handler.current(undefined, n);
          } catch {
            /* next tick retries */
          }
          n += 1;
          setClipCount(n);
          await sleep(CLIP_MS);
        }
      })();
      return true;
    }
    setMicError("");
    alive.current = true;
    let n = 0;
    void (async () => {
      while (alive.current) {
        let base64: string | undefined;
        try {
          await recorder.prepareToRecordAsync();
          recorder.record();
          await sleep(CLIP_MS);
          await recorder.stop();
          const uri = recorder.uri;
          if (uri) {
            try {
              base64 = await new File(uri).base64();
            } catch {
              base64 = undefined;
            }
          }
        } catch {
          base64 = undefined;
        }
        try {
          await handler.current(base64, n);
        } catch {
          /* keep looping; next clip retries */
        }
        n += 1;
        setClipCount(n);
      }
    })();
    return true;
  }, [recorder, S]);

  const stop = useCallback(() => {
    alive.current = false;
    try {
      if (recorder.isRecording) void recorder.stop();
    } catch {
      /* already stopped */
    }
  }, [recorder]);

  return { start, stop, clipCount, micError };
}
