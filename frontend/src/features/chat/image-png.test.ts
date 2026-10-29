import { afterEach, expect, it, vi } from "vitest";
import { imageToPng, pngFilename } from "./image-png";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("preserves PNG bytes and replaces other file extensions", async () => {
  const png = new Blob(["png"], { type: "image/png" });
  expect(await imageToPng(png)).toBe(png);
  expect(pngFilename("生成图片.webp")).toBe("生成图片.png");
  expect(pngFilename("方案.v2.jpg")).toBe("方案.v2.png");
  expect(pngFilename("图片")).toBe("图片.png");
});

it("encodes non-PNG originals at their full dimensions and releases the input URL", async () => {
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:original"), revokeObjectURL: vi.fn() });
  vi.stubGlobal("Image", class {
    naturalWidth = 2048; naturalHeight = 1024;
    onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const png = new Blob(["encoded"], { type: "image/png" });
  const encode = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback, mime) {
    expect(this.width).toBe(2048);
    expect(this.height).toBe(1024);
    expect(mime).toBe("image/png");
    callback(png);
  });
  expect(await imageToPng(new Blob(["webp"], { type: "image/webp" }))).toBe(png);
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0);
  expect(encode).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:original");
});

it("reports decoding failures and releases the input URL", async () => {
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:bad"), revokeObjectURL: vi.fn() });
  vi.stubGlobal("Image", class {
    onerror?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
  });
  await expect(imageToPng(new Blob(["bad"], { type: "image/jpeg" }))).rejects.toThrow("无法读取图片");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:bad");
});
