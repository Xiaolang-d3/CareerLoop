import captureWorkletUrl from "./voice-capture.worklet.js?url&no-inline";
import { voicePcmToWav } from "./voicePcm";

export const VOICE_CHUNK_MS = 400;

export type VoiceCapture = { start: (stream: MediaStream) => Promise<void>; close: () => void };

export function voiceCaptureSupported(): boolean {
  return typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined";
}

export function createVoiceCapture(onSegment: (audio: Blob) => void, onError: (message: string) => void, onLevel?: (level: number) => void): VoiceCapture {
  // Resume during the click gesture, before model preparation or permissions.
  const context = new AudioContext({ sampleRate: 16_000 });
  let closed = false;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let mute: GainNode | undefined;
  let level = 0;
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
        if (onLevel && event.data.length) {
          let energy = 0;
          for (const sample of event.data) energy += sample * sample;
          const rms = Math.sqrt(energy / event.data.length);
          const next = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(rms, 0.00001)) + 60) / 45));
          level = next > level ? next : level * 0.6 + next * 0.4;
          onLevel(level);
        }
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
      onLevel?.(0);
      if (node) { node.port.onmessage = null; node.port.close(); node.onprocessorerror = null; node.disconnect(); }
      source?.disconnect();
      mute?.disconnect();
      void context.close().catch(() => undefined);
    },
  };
}
