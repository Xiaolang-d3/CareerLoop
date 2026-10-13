import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GeneratedImage, AssetOriginalContext } from "./GeneratedImage";
import { AttachmentPreviewContext } from "./AttachmentPreviewDialog";
import { ResultActionsContext } from "./result-types";
import type { ChatAttachment } from "./types";

const asset: ChatAttachment = { id: "asset", origin: "generated", kind: "image", original_filename: "生成图片.png", parse_status: "parsed", width: 1024, height: 768 };
beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn().mockReturnValue("blob:image"), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("downloads privately and uses the generated resource for preview and archive", async () => {
  const load = vi.fn().mockResolvedValue({ file: new Blob(["image"], { type: "image/png" }) });
  const preview = vi.fn(), save = vi.fn();
  render(<AssetOriginalContext.Provider value={load}><AttachmentPreviewContext.Provider value={preview}><ResultActionsContext.Provider value={save}><GeneratedImage asset={asset} messageId={12} /></ResultActionsContext.Provider></AttachmentPreviewContext.Provider></AssetOriginalContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "下载原图" }));
  await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
  expect(load).toHaveBeenCalledWith(asset, expect.any(AbortSignal));
  fireEvent.click(screen.getByRole("button", { name: "预览 生成图片.png" }));
  expect(preview).toHaveBeenCalledWith(asset);
  fireEvent.click(screen.getByRole("button", { name: "保存 生成图片.png 到文件库" }));
  expect(save).toHaveBeenCalledWith(12, "asset:asset", true);
});

it("aborts a pending private download on close without producing a late file", async () => {
  let resolve!: (value: { file: Blob }) => void;
  const load = vi.fn().mockImplementation(() => new Promise(r => { resolve = r; }));
  const view = render(<AssetOriginalContext.Provider value={load}><GeneratedImage asset={asset} messageId={12} /></AssetOriginalContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "下载原图" }));
  const signal = load.mock.calls[0][1] as AbortSignal;
  view.unmount(); resolve({ file: new Blob(["late"]) });
  await Promise.resolve();
  expect(signal.aborted).toBe(true);
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});
