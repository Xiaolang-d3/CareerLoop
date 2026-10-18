import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

it("groups file metadata and actions below the image without making preview perform a write", () => {
  const load = vi.fn(), preview = vi.fn(), save = vi.fn();
  const view = render(<AssetOriginalContext.Provider value={load}><AttachmentPreviewContext.Provider value={preview}><ResultActionsContext.Provider value={save}><GeneratedImage asset={asset} messageId={12} /></ResultActionsContext.Provider></AttachmentPreviewContext.Provider></AssetOriginalContext.Provider>);
  const caption = view.container.querySelector("figcaption")!;
  expect(within(caption).getByText("1024 × 768")).toBeInTheDocument();
  expect(within(caption).queryByText(asset.original_filename)).not.toBeInTheDocument();
  expect(within(caption).queryByText("AI 生成")).not.toBeInTheDocument();
  expect(within(caption).getByRole("button", { name: "保存 生成图片.png 到文件库" })).toBeInTheDocument();
  expect(within(caption).getByRole("button", { name: "下载原图" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "预览 生成图片.png" }));
  expect(preview).toHaveBeenCalledWith(asset);
  expect(save).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
});

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

it("reveals and copies the full submitted prompt without previewing or regenerating", async () => {
  const prompt = `生成一张小猫图片。\n${"柔和光线与奶白色背景。".repeat(50)}\n不要文字、Logo 或水印。`;
  const copy = vi.fn().mockResolvedValue(undefined), preview = vi.fn(), save = vi.fn();
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  const view = render(<AttachmentPreviewContext.Provider value={preview}><ResultActionsContext.Provider value={save}><GeneratedImage asset={asset} messageId={12} prompt={prompt} /></ResultActionsContext.Provider></AttachmentPreviewContext.Provider>);
  const details = view.container.querySelector("details")!;
  expect(details).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText("生成提示词"));
  expect(details).toHaveAttribute("open");
  expect(view.container.querySelector(".generated-image-prompt-body > p")?.textContent).toBe(prompt);
  fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已复制提示词"));
  expect(copy).toHaveBeenCalledWith(prompt);
  expect(preview).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it("does not invent prompts for historical images without one and keeps portrait frames fitted", () => {
  const view = render(<GeneratedImage asset={{ ...asset, width: 1402, height: 1122 }} messageId={12} />);
  expect(screen.queryByText("生成提示词")).not.toBeInTheDocument();
  expect(parseFloat(view.container.querySelector("figure")!.style.maxWidth)).toBeCloseTo(460 * 1402 / 1122);
});

it("keeps the prompt readable when clipboard access fails", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  render(<GeneratedImage asset={asset} messageId={12} prompt="生成一张小猫图片" />);
  fireEvent.click(screen.getByText("生成提示词"));
  fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("复制失败，请选择提示词后手动复制"));
  expect(screen.getByText("生成一张小猫图片")).toBeVisible();
});
