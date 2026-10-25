import { expect, it } from "vitest";
import { voicePcmToWav } from "./voicePcm";

it("encodes each segment as a standalone mono WAV at the device sample rate", async () => {
  const blob = voicePcmToWav(new Float32Array([-2, -0.5, 0, 0.5, 2]), 48000);
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
  const view = new DataView(buffer);
  expect(blob.type).toBe("audio/wav");
  expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe("RIFF");
  expect(view.getUint32(24, true)).toBe(48000);
  expect(view.getUint32(40, true)).toBe(10);
  expect([0, 1, 2, 3, 4].map(index => view.getInt16(44 + index * 2, true))).toEqual([-32768, -16384, 0, 16384, 32767]);
});
