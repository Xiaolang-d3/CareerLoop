import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibrarySource, LibrarySourceDetail } from "../../types";
import { LibraryPage } from "./LibraryPage";
const source: LibrarySource = {
  id: 7,
  source_kind: "paste",
  title: "读书笔记",
  original_filename: "",
  mime_type: "text/plain",
  source_uri: "",
  privacy_mode: "redacted",
  enabled: true,
  parse_status: "ready",
  character_count: 120,
  file_available: false,
  created_at: "2026-09-21T00:00:00Z",
  updated_at: "2026-09-21T00:00:00Z"
};
const detail: LibrarySourceDetail = {
  ...source,
  content: "问题 reader@example.com",
  redacted_content: "问题 [邮箱已隐藏]",
  metadata: {}
};
function props() {
  return {
    editor: { name: "", privacyMode: "redacted" as const },
    sources: [source],
    folders: [{ id: 3, name: "项目资料" }],
    busy: false,
    sourceBusy: false,
    enhancedParse: false,
    onChange: vi.fn(),
    onEnhancedParseChange: vi.fn(),
    onImportFiles: vi.fn(),
    onCreateText: vi.fn().mockResolvedValue(undefined),
    onLoadSource: vi.fn().mockResolvedValue(detail),
    onUpdateSource: vi.fn().mockResolvedValue(undefined),
    onDownloadSource: vi.fn().mockResolvedValue(undefined),
    onDeleteSource: vi.fn().mockResolvedValue(undefined),
    onSave: vi.fn().mockResolvedValue(true),
    onOrganizeSource: vi.fn().mockResolvedValue(undefined),
    onCreateFolder: vi.fn().mockResolvedValue(undefined),
    onUseForChat: vi.fn().mockResolvedValue(undefined)
  };
}
async function preview() {
  fireEvent.click(screen.getByRole("button", { name: "操作 读书笔记" }));
  fireEvent.click(screen.getByRole("button", { name: "快速预览" }));
  return screen.findByRole("complementary", { name: "文件快速预览" });
}
describe("file library", () => {
  afterEach(cleanup);
  it("keeps categories in the module and protects AI text", async () => {
    const p = props();
    render(<LibraryPage {...p} />);
    expect(screen.getByRole("navigation", { name: "文件分类" })).toHaveTextContent("全部文件最近使用收藏回收站");
    const pane = await preview();
    await waitFor(() => expect(p.onOrganizeSource).toHaveBeenCalledWith(7, { opened: true }));
    fireEvent.click(within(pane).getByRole("button", { name: "AI 读取内容" }));
    expect(pane).toHaveTextContent("[邮箱已隐藏]");
    expect(pane).not.toHaveTextContent("reader@example.com");
    fireEvent.click(screen.getByRole("button", { name: "编辑正文" }));
    fireEvent.change(screen.getByLabelText("编辑资料正文"), { target: { value: "校正内容" } });
    fireEvent.click(screen.getByRole("button", { name: "保存正文" }));
    await waitFor(() => expect(p.onUpdateSource).toHaveBeenCalledWith(7, { content: "校正内容" }));
  });
  it("creates redacted notes in the current folder", async () => {
    const p = props();
    render(<LibraryPage {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "项目资料" }));
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.click(screen.getByRole("button", { name: "新建笔记" }));
    fireEvent.change(screen.getByLabelText("文件名称"), { target: { value: "会议纪要" } });
    fireEvent.change(screen.getByLabelText("笔记内容"), { target: { value: "检索评测" } });
    fireEvent.click(screen.getByRole("button", { name: "创建笔记" }));
    await waitFor(() => expect(p.onCreateText).toHaveBeenCalledWith("会议纪要", "检索评测", "redacted", 3));
  });
  it("trashes reversibly and confirms permanent deletion", async () => {
    const p = props();
    const view = render(<LibraryPage {...p} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 读书笔记" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(p.onDeleteSource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "移入回收站" }));
    await waitFor(() => expect(p.onOrganizeSource).toHaveBeenCalledWith(7, { trashed: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    view.rerender(<LibraryPage {...p} sources={[{ ...source, trashed_at: "2026-10-06T08:00:00Z" }]} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复 读书笔记" }));
    await waitFor(() => expect(p.onOrganizeSource).toHaveBeenCalledWith(7, { trashed: false }));
    await waitFor(() => expect(screen.getByRole("button", { name: "恢复 读书笔记" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 读书笔记" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
    expect(p.onDeleteSource).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(p.onDeleteSource).toHaveBeenCalledWith(7));
  });
  it("moves selected files and uses selected IDs for chat", async () => {
    const p = props();
    render(<LibraryPage {...p} sources={[source, { ...source, id: 8, title: "会议笔记" }]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择当前全部文件" }));
    fireEvent.click(screen.getByRole("button", { name: "用于对话" }));
    await waitFor(() => expect(p.onUseForChat).toHaveBeenCalledWith([8, 7]));
    await waitFor(() => expect(screen.getByRole("button", { name: "移动" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "移动" }));
    fireEvent.change(screen.getByLabelText("目标文件夹"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "移动文件" }));
    await waitFor(() => expect(p.onOrganizeSource).toHaveBeenCalledWith(7, { folder_id: 3 }));
    expect(p.onOrganizeSource).toHaveBeenCalledWith(8, { folder_id: 3 });
  });
  it("ignores stale search results", async () => {
    let complete!: (value: LibrarySource[]) => void;
    const search = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          })
      )
      .mockResolvedValue([]);
    render(<LibraryPage {...props()} onSearchSources={search} />);
    fireEvent.change(screen.getByLabelText("搜索文件名或内容"), { target: { value: "正文" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("正文"));
    fireEvent.change(screen.getByLabelText("搜索文件名或内容"), { target: { value: "不存在" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("不存在"));
    complete([source]);
    await waitFor(() => expect(screen.queryByRole("table")).not.toBeInTheDocument());
  });
  it("retains pending knowledge and failure feedback", async () => {
    render(
      <LibraryPage
        {...props()}
        pendingFacts={[{ id: 21, statement: "主导过检索评测", category: "project" }]}
        onReviewFact={vi.fn().mockRejectedValue(new Error("offline"))}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "知识与个性化" }));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByLabelText("待确认内容")).toHaveTextContent("主导过检索评测");
    expect(screen.getByLabelText("称呼")).not.toBeRequired();
  });
  it("does not reopen cancelled previews", async () => {
    let complete!: (value: LibrarySourceDetail) => void;
    render(
      <LibraryPage
        {...props()}
        onLoadSource={() =>
          new Promise((resolve) => {
            complete = resolve;
          })
        }
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "操作 读书笔记" }));
    fireEvent.click(screen.getByRole("button", { name: "快速预览" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    complete(detail);
    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
  });
});
