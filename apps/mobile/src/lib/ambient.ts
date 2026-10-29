import { AudioModule, setAudioModeAsync, useAudioStream } from "expo-audio";
import { File } from "expo-file-system";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStrings } from "./i18n";

const CLIP_MS = 3000;

/**
 * Meta's /asr/transcribe only accepts mono 16-bit WAV at 16/24 kHz, and the
 * server has no ffmpeg to convert the old m4a/3gp clips — so every clip
 * came back "(no processable audio)". We record native 16 kHz mono WAV on
 * the device instead (AudioStream file recording, Android + iOS), which the
 * server consumes directly: loudness from the PCM, transcripts from Meta.
 */
const STREAM_OPTIONS = { sampleRate: 16000, channels: 1, encoding: "int16" as const };

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

/** Peak amplitude 0..1 of an int16 PCM buffer (subsampled for speed). */
function int16Peak(data: ArrayBuffer): number {
  const view = new DataView(data);
  const n = Math.floor(view.byteLength / 2);
  if (!n) return 0;
  const step = Math.max(1, Math.floor(n / 512));
  let peak = 0;
  for (let i = 0; i < n; i += step) {
    const a = Math.abs(view.getInt16(i * 2, true)) / 32768;
    if (a > peak) peak = a;
  }
  return peak;
}

async function readAndClean(uri: string): Promise<string> {
  const base64 = await new File(uri).base64();
  try {
    new File(uri).delete();
  } catch {
    /* cache cleanup is best-effort */
  }
  return base64;
}

/**
 * Live loop: records back-to-back 3s WAV clips on one continuous mic stream
 * and hands each base64 clip to `onClip`. Same interface as before — only
 * the capture engine changed (file-per-clip instead of recorder restart,
 * so there are no stop/prepare gaps between clips).
 */
export function useAmbientClips(onClip: (audioBase64: string | undefined, clipIndex: number) => Promise<void>) {
  const S = useStrings();
  const alive = useRef(false);
  const started = useRef(false);
  const recording = useRef(false);
  const run = useRef(0);
  const [clipCount, setClipCount] = useState(0);
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState("");
  const handler = useRef(onClip);
  useEffect(() => {
    handler.current = onClip;
  }, [onClip]);

  const onBuffer = useCallback((buffer: { data: ArrayBuffer }) => {
    if (!alive.current) return;
    const peak = int16Peak(buffer.data);
    setLevel((prev) => Math.max(peak, prev * 0.82));
  }, []);
  const options = useMemo(() => ({ ...STREAM_OPTIONS, onBuffer }), [onBuffer]);
  const { stream } = useAudioStream(options);
  const streamRef = useRef(stream);
  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  // Unmount: never leave the mic open.
  useEffect(
    () => () => {
      alive.current = false;
      run.current += 1;
      try {
        streamRef.current.stop();
      } catch {
        /* already stopped */
      }
    },
    [],
  );

  /** Mic-blocked fallback: keep the check-in loop going without audio. */
  const runSilentLoop = useCallback((myRun: number) => {
    void (async () => {
      let n = 0;
      while (alive.current && run.current === myRun) {
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
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (alive.current) return true;
    const ok = await ensureMicAccess();
    if (!ok) {
      setMicError(S.listenMicBlocked);
      alive.current = true;
      const myRun = ++run.current;
      runSilentLoop(myRun);
      return true;
    }
    setMicError("");
    try {
      if (!started.current) {
        await streamRef.current.start();
        started.current = true;
      }
    } catch {
      // Mic busy or stream failed: degrade to silent check-ins.
      setMicError(S.listenMicBlocked);
      alive.current = true;
      const myRun = ++run.current;
      runSilentLoop(myRun);
      return true;
    }
    alive.current = true;
    const myRun = ++run.current;
    void (async () => {
      let n = 0;
      while (alive.current && run.current === myRun) {
        let base64: string | undefined;
        try {
          await streamRef.current.startFileRecordingAsync({ format: "wav" });
          recording.current = true;
          await sleep(CLIP_MS);
          const result = await streamRef.current.stopFileRecordingAsync();
          recording.current = false;
          setLevel(0);
          if (!alive.current || run.current !== myRun) {
            // Stopped mid-clip: discard, don't upload a partial caption.
            try {
              new File(result.uri).delete();
            } catch {
              /* ignore */
            }
            break;
          }
          base64 = await readAndClean(result.uri);
        } catch {
          recording.current = false;
          base64 = undefined;
        }
        if (!alive.current || run.current !== myRun) break;
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
  }, [S, runSilentLoop]);

  const stop = useCallback(() => {
    alive.current = false;
    run.current += 1;
    setLevel(0);
    try {
      // Finalize any in-flight clip file (its bytes are discarded by the
      // loop's run check) and release the mic.
      if (recording.current) {
        recording.current = false;
        void streamRef.current
          .stopFileRecordingAsync()
          .then((r) => {
            try {
              new File(r.uri).delete();
            } catch {
              /* ignore */
            }
          })
          .catch(() => {});
      }
      streamRef.current.stop();
      started.current = false;
    } catch {
      /* already stopped */
    }
  }, []);

  return { start, stop, clipCount, micError, level };
}

/**
 * Press-and-hold single WAV clip (manual Listen mode, Home hold-to-talk).
 * `holdEnd` resolves to the base64 WAV, or null when nothing usable was
 * captured. Voice level streams through `level` while held.
 */
export function useWavHold() {
  const S = useStrings();
  const holding = useRef(false);
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState("");

  const onBuffer = useCallback((buffer: { data: ArrayBuffer }) => {
    if (!holding.current) return;
    const peak = int16Peak(buffer.data);
    setLevel((prev) => Math.max(peak, prev * 0.82));
  }, []);
  const options = useMemo(() => ({ ...STREAM_OPTIONS, onBuffer }), [onBuffer]);
  const { stream } = useAudioStream(options);
  const streamRef = useRef(stream);
  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  useEffect(
    () => () => {
      holding.current = false;
      try {
        streamRef.current.stop();
      } catch {
        /* already stopped */
      }
    },
    [],
  );

  const holdStart = useCallback(async (): Promise<boolean> => {
    if (holding.current) return true;
    setMicError("");
    const ok = await ensureMicAccess();
    if (!ok) {
      setMicError(S.listenMicBlocked);
      return false;
    }
    try {
      await streamRef.current.start();
      await streamRef.current.startFileRecordingAsync({ format: "wav" });
    } catch {
      try {
        streamRef.current.stop();
      } catch {
        /* ignore */
      }
      setMicError(S.listenMicBlocked);
      return false;
    }
    holding.current = true;
    return true;
  }, [S]);

  const holdEnd = useCallback(async (): Promise<string | null> => {
    if (!holding.current) return null;
    holding.current = false;
    setLevel(0);
    try {
      const result = await streamRef.current.stopFileRecordingAsync();
      streamRef.current.stop();
      return await readAndClean(result.uri);
    } catch {
      try {
        streamRef.current.stop();
      } catch {
        /* ignore */
      }
      return null;
    }
  }, []);

  const clearMicError = useCallback(() => setMicError(""), []);

  return { holdStart, holdEnd, level, micError, clearMicError };
}
