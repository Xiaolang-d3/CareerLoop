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
});
