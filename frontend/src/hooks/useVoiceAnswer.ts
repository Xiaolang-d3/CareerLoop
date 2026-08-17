import { useCallback, useEffect, useRef, useState } from "react";

const SPEECH_LANG = "zh-CN";

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export type VoiceAnswer = {
  /** The browser supports both speech recognition and speech synthesis. */
  recognitionSupported: boolean;
  synthesisSupported: boolean;
  listening: boolean;
  interimTranscript: string;
  speaking: boolean;
  error: string;
  startListening: () => void;
  stopListening: () => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
};

/**
 * Wraps the browser-native Web Speech API for a single practice question:
 * transcribe a spoken answer (mic) and read a question aloud (speaker).
 * Everything runs client-side; no audio ever leaves the browser.
 */
export function useVoiceAnswer(onFinalTranscript: (text: string) => void): VoiceAnswer {
  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  onFinalTranscriptRef.current = onFinalTranscript;

  const recognitionSupported = getSpeechRecognitionCtor() !== null;
  const synthesisSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => () => {
    recognitionRef.current?.abort();
    if (synthesisSupported) window.speechSynthesis.cancel();
  }, [synthesisSupported]);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("当前浏览器不支持语音识别，请使用最新版 Chrome");
      return;
    }
    setError("");
    setInterimTranscript("");
    const recognition = new Ctor();
    recognition.lang = SPEECH_LANG;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript || "";
        if (result.isFinal) finalChunk += transcript;
        else interimChunk += transcript;
      }
      if (finalChunk.trim()) onFinalTranscriptRef.current(finalChunk.trim());
      setInterimTranscript(interimChunk);
    };
    recognition.onerror = (event) => {
      setError(event.error === "not-allowed" ? "麦克风权限被拒绝，请在浏览器设置中允许后重试" : "语音识别出现问题，请重试");
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      setInterimTranscript("");
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError("无法启动语音识别，请重试");
    }
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (!synthesisSupported || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LANG;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [synthesisSupported]);

  const stopSpeaking = useCallback(() => {
    if (!synthesisSupported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [synthesisSupported]);

  return {
    recognitionSupported,
    synthesisSupported,
    listening,
    interimTranscript,
    speaking,
    error,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
