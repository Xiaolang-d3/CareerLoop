import captureWorkletUrl from "./voice-capture.worklet.js?url&no-inline";
import { voicePcmToWav } from "./voicePcm";

export const VOICE_CHUNK_MS = 400;

export type VoiceCapture = { start: (stream: MediaStream) => Promise<void>; close: () => void };

export function voiceCaptureSupported(): boolean {
  return typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined";
}

export function createVoiceCapture(onSegment: (audio: Blob) => void, onError: (message: string) => void): VoiceCapture {
  // Resume during the click gesture, before model preparation or permissions.
  const context = new AudioContext({ sampleRate: 16_000 });
  let closed = false;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let mute: GainNode | undefined;
  void context.resume().catch(() => { if (!closed) onError("无法启动音频采集，请重试。"); });
  return {
    async start(stream) {
      await context.audioWorklet.addModule(captureWorkletUrl);
      if (closed) return;
      let frames: Float32Array[] = [];
      let samples = 0;
      node = new AudioWorkletNode(context, "voice-capture");
      node.port.onmessage = event => {
        if (closed || !(event.data instanceof Float32Array)) return;
        frames.push(event.data);
        samples += event.data.length;
        if (samples >= context.sampleRate * VOICE_CHUNK_MS / 1000) {
          const pcm = new Float32Array(samples);
          let offset = 0;
          for (const frame of frames) { pcm.set(frame, offset); offset += frame.length; }
          frames = []; samples = 0;
          onSegment(voicePcmToWav(pcm, context.sampleRate));
        }
      };
      node.onprocessorerror = () => { if (!closed) onError("音频采集已中断，请重试。"); };
      source = context.createMediaStreamSource(stream);
      mute = context.createGain();
      mute.gain.value = 0;
      source.connect(node); node.connect(mute); mute.connect(context.destination);
      await context.resume();
    },
    close() {
      if (closed) return;
      closed = true;
      if (node) { node.port.onmessage = null; node.port.close(); node.onprocessorerror = null; node.disconnect(); }
      source?.disconnect();
      mute?.disconnect();
      void context.close().catch(() => undefined);
    },
  };
}
