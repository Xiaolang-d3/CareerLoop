import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePreview } from "./FilePreview";
import type { LibrarySourceDetail } from "../../types";
const source: LibrarySourceDetail = {
  id: 1,
  source_kind: "upload",
  title: "笔记",
  original_filename: "notes.txt",
  mime_type: "text/plain",
  source_uri: "",
  privacy_mode: "redacted",
  enabled: true,
  parse_status: "ready",
  character_count: 5,
  file_available: true,
  created_at: "",
  updated_at: "",
  content: "校正后的文字 reader@example.com",
  redacted_content: "校正后的文字 [邮箱已隐藏]",
  metadata: { content_edited: true }
};
describe("original versus AI text", () => {
  afterEach(cleanup);
  it("fetches original file bytes separately from corrected and redacted AI text", async () => {
    const load = vi.fn().mockResolvedValue({ text: async () => "导入时的原文" } as Blob);
    const view = render(<FilePreview source={source} mode="original" loadOriginal={load} />);
    expect(await screen.findByText("导入时的原文")).toBeInTheDocument();
    expect(screen.queryByText(/校正后的/)).not.toBeInTheDocument();
    view.rerender(<FilePreview source={source} mode="text" loadOriginal={load} />);
    expect(screen.getByText(/校正后的文字/)).toHaveTextContent("[邮箱已隐藏]");
    expect(load).toHaveBeenCalledOnce();
  });
  it("reads a saved Markdown original with headings and tables without executing embedded HTML", async () => {
    const load = vi.fn().mockResolvedValue({ text: async () => "# 成果标题\n\n|名称|状态|\n|---|---|\n|报告|保存|\n\n<script>untrusted()</script>" } as Blob);
    const view = render(<FilePreview source={{ ...source, original_filename: "报告.md", mime_type: "text/markdown" }} mode="original" loadOriginal={load} />);
    expect(await screen.findByRole("heading", { name: "成果标题" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("报告保存");
    expect(view.container.querySelector("script")).toBeNull();
  });
});

it("reads archived local images through the private loader and releases URLs", async () => {
  const { waitFor } = await import("@testing-library/react");
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn().mockReturnValue("blob:private-image"), revokeObjectURL: vi.fn() }));
  const id = "a".repeat(32);
  const loadAsset = vi.fn().mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  const source = { id: 22, title: "生图成果", original_filename: "回答.md", mime_type: "text/markdown", file_available: true, content: "" } as LibrarySourceDetail;
  const view = render(<FilePreview source={source} mode="original" loadOriginal={vi.fn().mockResolvedValue({ text: async () => `# 生图成果\n\n![生成图片](assets/${id}.png)` } as Blob)} loadAsset={loadAsset} />);
  await waitFor(() => expect(screen.getByRole("img", { name: "生成图片" })).toHaveAttribute("src", "blob:private-image"));
  expect(loadAsset).toHaveBeenCalledWith(22, id, expect.any(AbortSignal));
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-image");
  vi.unstubAllGlobals();
});
