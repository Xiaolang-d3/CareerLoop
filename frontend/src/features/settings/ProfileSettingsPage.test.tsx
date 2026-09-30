import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CandidateEditor, LibrarySource, LibrarySourceDetail } from "../../types";
import { ProfileSettingsPage } from "./ProfileSettingsPage";

const editor: CandidateEditor = {
  name: "小林", targetRole: "", targetCity: "", salaryMin: "", salaryMax: "",
  skills: "", industries: "", blockedKeywords: "", blockedCompanies: "",
  resumeText: "", resumeFilename: "", resumeRedactedText: "", privacyMode: "redacted"
};

const source: LibrarySource = {
  id: 7, source_kind: "upload", title: "读书笔记", original_filename: "notes.md",
  mime_type: "text/markdown", source_uri: "", privacy_mode: "redacted", enabled: true,
  parse_status: "ready", character_count: 120, file_available: true,
  created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z"
};

function props() {
  return {
    editor,
    sources: [source],
    busy: false,
    sourceBusy: false,
    enhancedParse: false,
    onChange: vi.fn(),
    onEnhancedParseChange: vi.fn(),
    onImportFiles: vi.fn(),
    onCreateText: vi.fn().mockResolvedValue(undefined),
    onLoadSource: vi.fn().mockResolvedValue({ ...source, content: "每天记录一个问题", redacted_content: "每天记录一个问题", metadata: {} } satisfies LibrarySourceDetail),
    onUpdateSource: vi.fn().mockResolvedValue(undefined),
    onDownloadSource: vi.fn().mockResolvedValue(undefined),
    onDeleteSource: vi.fn().mockResolvedValue(undefined),
    onSave: vi.fn().mockResolvedValue(true)
  };
}

describe("ProfileSettingsPage multi-source library", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows independent sources and previews one without merging content", async () => {
    const pageProps = props();
    render(<ProfileSettingsPage {...pageProps} />);
    expect(screen.getByRole("list", { name: "资料来源列表" })).toHaveTextContent("读书笔记");
    expect(screen.getByText("notes.md · 120 字 · 已就绪")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "预览 读书笔记" }));
    expect(await screen.findByLabelText("来源预览")).toHaveTextContent("每天记录一个问题");
    expect(pageProps.onLoadSource).toHaveBeenCalledWith(7);
  });

  it("creates a pasted source with redacted mode by default", async () => {
    const pageProps = props();
    render(<ProfileSettingsPage {...pageProps} sources={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "粘贴文本" }));
    fireEvent.change(screen.getByLabelText("来源标题"), { target: { value: "会议纪要" } });
    fireEvent.change(screen.getByLabelText("来源内容"), { target: { value: "本周完成检索评测" } });
    fireEvent.click(screen.getByRole("button", { name: "创建来源" }));
    await waitFor(() => expect(pageProps.onCreateText).toHaveBeenCalledWith("会议纪要", "本周完成检索评测", "redacted"));
  });

  it("edits the extracted text and offers the original file separately", async () => {
    const pageProps = props();
    render(<ProfileSettingsPage {...pageProps} />);
    fireEvent.click(screen.getByRole("button", { name: "预览 读书笔记" }));
    await screen.findByLabelText("来源预览");
    fireEvent.click(screen.getByRole("button", { name: "编辑正文" }));
    fireEvent.change(screen.getByRole("textbox", { name: "编辑资料正文" }), { target: { value: "修改后的笔记内容" } });
    fireEvent.click(screen.getByRole("button", { name: "保存正文" }));
    await waitFor(() => expect(pageProps.onUpdateSource).toHaveBeenCalledWith(7, { content: "修改后的笔记内容" }));
    fireEvent.click(screen.getByRole("button", { name: "下载原文件" }));
    await waitFor(() => expect(pageProps.onDownloadSource).toHaveBeenCalledWith(expect.objectContaining({ id: 7 })));
  });

  it("updates enable and privacy state per source", async () => {
    const pageProps = props();
    render(<ProfileSettingsPage {...pageProps} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "原文" }));
    await waitFor(() => expect(pageProps.onUpdateSource).toHaveBeenCalledWith(7, { privacy_mode: "original" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "启用" }));
    await waitFor(() => expect(pageProps.onUpdateSource).toHaveBeenCalledWith(7, { enabled: false }));
  });

  it("requires confirmation before permanent source deletion", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const pageProps = props();
    render(<ProfileSettingsPage {...pageProps} />);
    fireEvent.click(screen.getByRole("button", { name: "删除 读书笔记" }));
    await waitFor(() => expect(pageProps.onDeleteSource).toHaveBeenCalledWith(7));
  });

  it("keeps display name optional and saves an empty value", async () => {
    const pageProps = props();
    function Harness() {
      const [current, setCurrent] = useState({ ...editor, name: "" });
      return <ProfileSettingsPage {...pageProps} editor={current} onChange={setCurrent} />;
    }
    render(<Harness />);
    expect(screen.getByText("称呼是可选项，不会阻止导入或保存资料。")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("例如：小林"), { target: { value: "读者" } });
    fireEvent.change(screen.getByPlaceholderText("例如：小林"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存个性化信息" }));
    await waitFor(() => expect(pageProps.onSave).toHaveBeenCalledOnce());
  });

  it("retains pending knowledge when review fails", async () => {
    render(<ProfileSettingsPage {...props()} pendingFacts={[{ id: 21, statement: "主导过检索评测", category: "project" }]} onReviewFact={vi.fn().mockRejectedValue(new Error("offline"))} />);
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByLabelText("待确认内容")).toHaveTextContent("主导过检索评测");
  });
});
