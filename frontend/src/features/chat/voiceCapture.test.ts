import { afterEach, expect, it, vi } from "vitest";
import { createVoiceCapture } from "./voiceCapture";

afterEach(() => vi.unstubAllGlobals());

it("streams quiet PCM too, keeps chunk samples in order, and releases the audio graph immediately", async () => {
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const mute = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const context = { sampleRate: 16_000, resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) }, createMediaStreamSource: () => source, createGain: () => mute, destination: {} };
  const node = { port: { onmessage: null as null | ((event: { data: Float32Array }) => void), close: vi.fn() }, connect: vi.fn(), disconnect: vi.fn(), onprocessorerror: null };
  vi.stubGlobal("AudioContext", vi.fn(function () { return context; }));
  vi.stubGlobal("AudioWorkletNode", vi.fn(function () { return node; }));
  const emit = vi.fn();
  const fail = vi.fn();
  const capture = createVoiceCapture(emit, fail);
  await capture.start({} as MediaStream);
  const receive = node.port.onmessage!;
  for (let index = 0; index < 4; index += 1) receive({ data: new Float32Array(1600) });
  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit.mock.calls[0][0].size).toBe(44 + 6400 * 2);
  expect(mute.gain.value).toBe(0);
  capture.close(); capture.close();
  for (let index = 0; index < 4; index += 1) receive({ data: new Float32Array(1600).fill(0.1) });
  expect(emit).toHaveBeenCalledTimes(1);
  expect(node.port.close).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
  expect(source.disconnect).toHaveBeenCalled();
  expect(fail).not.toHaveBeenCalled();
});
