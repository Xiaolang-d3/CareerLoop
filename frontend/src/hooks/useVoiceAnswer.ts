import { useCallback, useEffect, useRef, useState } from "react";
import { createVoiceCapture, voiceCaptureSupported, VOICE_CHUNK_MS, type VoiceCapture } from "../features/chat/voiceCapture";
import type { VoiceInputService, VoiceInputSession, VoiceTranscript } from "../features/chat/voiceInput";

type VoiceStatus = "idle" | "preparing" | "starting" | "listening";
const MAX_RECORDING_MS = 10 * 60_000;
const MAX_QUEUED_AUDIO_MS = 8000;

export function useVoiceAnswer(onFinalTranscript: (update: VoiceTranscript) => void, service?: VoiceInputService, onAudioLevel?: (level: number) => void) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState("");
  const sessionRef = useRef<{ cancel: () => void } | null>(null);
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  onFinalTranscriptRef.current = onFinalTranscript;
  const onAudioLevelRef = useRef(onAudioLevel);
  onAudioLevelRef.current = onAudioLevel;
  const serviceRef = useRef(service);
  serviceRef.current = service;

  useEffect(() => () => { sessionRef.current?.cancel(); }, []);

  const startListening = useCallback(async () => {
    if (sessionRef.current) return;
    setError("");
    onAudioLevelRef.current?.(0);
    if (window.isSecureContext === false) {
      setError("麦克风需要安全连接，请通过 HTTPS 或本机 localhost 地址打开灯灯。");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !voiceCaptureSupported()) {
      setError("当前浏览器不支持录音。请使用支持麦克风录音的浏览器，或点击输入框使用系统听写。");
      return;
    }
    const currentService = serviceRef.current;
    if (!currentService) {
      setError("离线语音服务尚未连接，请刷新页面后重试。");
      return;
    }

    const controller = new AbortController();
    let capture: VoiceCapture | undefined;
    let inputSession: VoiceInputSession | undefined;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending: Blob[] = [];
    let transcribing = false;
    const releaseMic = () => { stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); };
    const cancel = () => {
      controller.abort();
      clearTimeout(timer);
      pending.length = 0;
      capture?.close();
      void inputSession?.close();
      releaseMic();
      onAudioLevelRef.current?.(0);
      sessionRef.current = null;
    };
    const fail = (message: string) => {
      if (controller.signal.aborted) return;
      cancel();
      setStatus("idle");
      setError(message);
    };
    const drain = async () => {
      if (transcribing || controller.signal.aborted) return;
      transcribing = true;
      try {
        while (pending.length && !controller.signal.aborted) {
          const updates = await inputSession!.accept(pending.shift()!, controller.signal);
          if (controller.signal.aborted) return;
          for (const update of updates) {
            if (controller.signal.aborted) return;
            onFinalTranscriptRef.current(update);
          }
        }
      } catch (reason) {
        fail(reason instanceof Error ? reason.message : "离线识别未能完成，请重试。");
      } finally {
        transcribing = false;
      }
    };
    sessionRef.current = { cancel };
    setStatus("preparing");
    try {
      capture = createVoiceCapture(audio => {
        if (controller.signal.aborted) return;
        if (pending.length * VOICE_CHUNK_MS >= MAX_QUEUED_AUDIO_MS) {
          fail("当前设备处理语音较慢，已暂停以避免文字持续延迟。已显示的文字已保留，请稍后重试。");
          return;
        }
        pending.push(audio);
        void drain();
      }, fail, level => {
        if (!controller.signal.aborted) onAudioLevelRef.current?.(level);
      });
      await currentService.prepare(controller.signal);
      if (controller.signal.aborted) return;
      setStatus("starting");
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (controller.signal.aborted) { releaseMic(); return; }
      for (const track of stream.getTracks()) track.onended = () => fail("麦克风已断开，请重新打开语音输入。");
      // Permission prompts may remain open for minutes. Create the short-idle
      // server session only after permission is granted.
      inputSession = await currentService.open(controller.signal);
      if (controller.signal.aborted) { void inputSession.close(); return; }
      await capture.start(stream);
      if (controller.signal.aborted) return;
      setStatus("listening");
      timer = setTimeout(() => fail("已完成 10 分钟连续语音输入，文字已保留。点击语音可以继续。"), MAX_RECORDING_MS);
    } catch (reason) {
      if (reason instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(reason.name)) {
        fail("无法使用麦克风。请在浏览器和系统设置中允许麦克风权限后重试。");
      } else if (reason instanceof DOMException && ["NotFoundError", "NotReadableError"].includes(reason.name)) {
        fail("无法获取麦克风声音，请检查麦克风是否已连接或被占用。");
      } else {
        fail(reason instanceof Error ? reason.message : "无法启动录音，请重试。");
      }
    }
  }, []);

  const cancelListening = useCallback(() => {
    sessionRef.current?.cancel();
    setStatus("idle");
    setError("");
  }, []);

  return { status, listening: status !== "idle", error, startListening, stopListening: cancelListening, cancelListening };
}
