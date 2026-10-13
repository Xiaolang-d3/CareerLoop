import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AttachmentThumbnailContext, HistoryAttachment } from "./HistoryAttachment";
import type { ChatAttachment } from "./types";

const image: ChatAttachment = { id: "image", kind: "image", original_filename: "示意图.png", parse_status: "pending" };
beforeEach(() => vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn().mockReturnValue("blob:thumb"), revokeObjectURL: vi.fn() })));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("fetches a private thumbnail, previews and archives independently, and releases the URL", async () => {
  const load = vi.fn().mockResolvedValue(new Blob(["thumbnail"], { type: "image/webp" }));
  const preview = vi.fn(), save = vi.fn();
  const view = render(<AttachmentThumbnailContext.Provider value={load}><HistoryAttachment attachment={image} onPreview={preview} onSave={save} /></AttachmentThumbnailContext.Provider>);
  await waitFor(() => expect(view.container.querySelector("img")).toHaveAttribute("src", "blob:thumb"));
  fireEvent.click(screen.getByRole("button", { name: "保存 示意图.png 到文件库" }));
  expect(save).toHaveBeenCalledOnce(); expect(preview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "预览 示意图.png" }));
  expect(preview).toHaveBeenCalledOnce();
  const signal = load.mock.calls[0][1] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:thumb");
});

it("keeps preview available when a thumbnail fails and retries without re-uploading", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("missing")).mockResolvedValueOnce(new Blob(["thumbnail"]));
  const view = render(<AttachmentThumbnailContext.Provider value={load}><HistoryAttachment attachment={image} onPreview={vi.fn()} /></AttachmentThumbnailContext.Provider>);
  fireEvent.click(await screen.findByRole("button", { name: "缩略图加载失败，重试" }));
  await waitFor(() => expect(view.container.querySelector("img")).toHaveAttribute("src", "blob:thumb"));
  expect(screen.getByRole("button", { name: "预览 示意图.png" })).toBeEnabled();
  expect(load).toHaveBeenCalledTimes(2);
});
