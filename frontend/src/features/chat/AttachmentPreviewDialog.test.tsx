import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentPreviewDialog } from "./AttachmentPreviewDialog";
import type { ChatAttachment } from "./types";

vi.mock("../library/PdfReader", () => ({ default: ({ bytes, title }: { bytes: Uint8Array; title: string }) => <div data-testid="pdf-reader">{title} · {new TextDecoder().decode(bytes)}</div> }));

function file(text: string, type = "text/plain"): Blob {
  return { size: new TextEncoder().encode(text).length, type, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer } as Blob;
}

function attachment(filename: string, overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return { id: "test-file", kind: "document", original_filename: filename, parse_status: "parsed", ...overrides };
}

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn().mockReturnValue("blob:preview-test"), revokeObjectURL: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("attachment preview", () => {
  it("loads the original PDF bytes into the shared reader and enables download", async () => {
    const load = vi.fn().mockResolvedValue({ file: file("%PDF-synthetic", "application/pdf") });
    render(<AttachmentPreviewDialog attachment={attachment("资料.pdf")} loadOriginal={load} onClose={vi.fn()} />);
    expect(await screen.findByTestId("pdf-reader")).toHaveTextContent("%PDF-synthetic");
    expect(screen.getByRole("button", { name: "下载原文件" })).toBeEnabled();
    expect(load.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  });

  it("uses the selected local file without fetching or sending the message", async () => {
    const load = vi.fn();
    render(<AttachmentPreviewDialog attachment={attachment("草稿.txt")} localFile={file("本地草稿原文") as File} loadOriginal={load} onClose={vi.fn()} />);
    expect(await screen.findByText("本地草稿原文")).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });

  it("renders Markdown tables and skips embedded HTML", async () => {
    const content = "# 资料标题\n\n|名称|状态|\n|---|---|\n|附件|就绪|\n\n<script>untrusted()</script>";
    render(<AttachmentPreviewDialog attachment={attachment("notes.md")} loadOriginal={async () => ({ file: file(content) })} onClose={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "资料标题" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("就绪");
    expect(screen.getByRole("dialog").querySelector("script")).toBeNull();
  });

  it("shows extracted Word text with a clear original-layout download option", async () => {
    render(<AttachmentPreviewDialog attachment={attachment("报告.docx")} loadOriginal={async () => ({ file: file("docx bytes"), parsedText: "Word 提取的正文" })} onClose={vi.fn()} />);
    expect(await screen.findByText("Word 提取的正文")).toBeInTheDocument();
    expect(screen.getByText(/完整排版请下载原文件查看/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载原文件" })).toBeEnabled();
  });

  it("shows a retryable read failure and recovers without losing the attachment", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("原文件暂时不可用")).mockResolvedValueOnce({ file: file("恢复后的原文") });
    render(<AttachmentPreviewDialog attachment={attachment("资料.txt")} loadOriginal={load} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("原文件暂时不可用");
    expect(screen.getByRole("button", { name: "下载原文件" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByText("恢复后的原文")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("releases image URLs, traps focus, and restores the trigger on close", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const close = vi.fn();
    const view = render(<AttachmentPreviewDialog attachment={attachment("picture.png", { kind: "image" })} loadOriginal={async () => ({ file: file("image", "image/png") })} onClose={close} />);
    expect(await screen.findByRole("img", { name: "picture.png" })).toHaveAttribute("src", "blob:preview-test");
    const dialog = screen.getByRole("dialog");
    const controls = within(dialog).getAllByRole("button");
    controls.at(-1)!.focus();
    fireEvent.keyDown(controls.at(-1)!, { key: "Tab" });
    expect(controls[0]).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-test");
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("aborts an old preview and ignores a late read after the dialog closes", async () => {
    let resolve!: (value: { file: Blob }) => void;
    const load = vi.fn().mockImplementation(() => new Promise<{ file: Blob }>(done => { resolve = done; }));
    const view = render(<AttachmentPreviewDialog attachment={attachment("slow.txt")} loadOriginal={load} onClose={vi.fn()} />);
    const signal = load.mock.calls[0][1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    resolve({ file: file("迟到的文字") });
    await waitFor(() => expect(screen.queryByText("迟到的文字")).not.toBeInTheDocument());
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("downloads the original bytes using the complete Chinese filename", async () => {
    const original = file("完整的源码内容");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("中文资料.txt");
      expect(this.href).toBe("blob:preview-test");
    });
    render(<AttachmentPreviewDialog attachment={attachment("中文资料.txt")} loadOriginal={async () => ({ file: original })} onClose={vi.fn()} />);
    await screen.findByText("完整的源码内容");
    fireEvent.click(screen.getByRole("button", { name: "下载原文件" }));
    expect(click).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledWith(original);
  });
});


it("switches between images in one preview without losing the original focus target", async () => {
  const first = attachment("first.png", { id: "first", kind: "image" });
  const second = attachment("second.png", { id: "second", kind: "image" });
  const navigate = vi.fn();
  const load = vi.fn().mockResolvedValue({ file: file("image", "image/png") });
  const trigger = document.createElement("button"); document.body.appendChild(trigger); trigger.focus();
  const view = render(<AttachmentPreviewDialog attachment={first} gallery={[first, second]} onNavigate={navigate} loadOriginal={load} onClose={vi.fn()} />);
  await screen.findByRole("img", { name: "first.png" });
  fireEvent.click(screen.getByRole("button", { name: "下一张图片" }));
  expect(navigate).toHaveBeenCalledWith(second);
  view.rerender(<AttachmentPreviewDialog attachment={second} gallery={[first, second]} onNavigate={navigate} loadOriginal={load} onClose={vi.fn()} />);
  expect(await screen.findByRole("img", { name: "second.png" })).toBeInTheDocument();
  expect(screen.getByText("2 / 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下一张图片" })).toBeDisabled();
  view.unmount(); expect(trigger).toHaveFocus(); trigger.remove();
});
