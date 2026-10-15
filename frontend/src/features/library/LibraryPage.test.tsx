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
    onCreateCollection: vi.fn().mockResolvedValue(undefined),
    onRenameCollection: vi.fn().mockResolvedValue(undefined),
    onDeleteCollection: vi.fn().mockResolvedValue(undefined),
    onUpdateCollectionSources: vi.fn().mockResolvedValue(undefined),
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
  it("reveals secondary controls only when requested and keeps active filters visible", () => {
    render(<LibraryPage {...props()} />);
    expect(screen.queryByRole("button", { name: "上传文件" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "文件库设置" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("筛选来源")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(screen.getByRole("button", { name: "上传文件" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建笔记" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "添加" }), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "上传文件" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.change(screen.getByLabelText("筛选来源"), { target: { value: "chat" } });
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    expect(screen.queryByLabelText("筛选来源")).not.toBeInTheDocument();
    expect(screen.getByText("对话成果")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByRole("table", { name: "文件列表" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "文件库更多选项" }));
    fireEvent.click(screen.getByRole("button", { name: "网格视图" }));
    expect(screen.getByRole("table")).toHaveClass("fl-grid");
  });
  it("opens a saved result directly and consumes the initial source once", async () => {
    const p = props(), consumed = vi.fn();
    const view = render(<LibraryPage {...p} initialSourceId={7} onInitialSourceConsumed={consumed} />);
    await screen.findByText("问题 reader@example.com");
    expect(screen.getByRole("button", { name: "返回文件库" })).toBeInTheDocument();
    expect(p.onLoadSource).toHaveBeenCalledWith(7);
    expect(consumed).toHaveBeenCalledOnce();
    view.rerender(<LibraryPage {...p} initialSourceId={null} onInitialSourceConsumed={consumed} />);
    expect(p.onLoadSource).toHaveBeenCalledOnce();
  });
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
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    fireEvent.click(screen.getByRole("button", { name: "新建笔记" }));
    fireEvent.change(screen.getByLabelText("文件名称"), { target: { value: "会议纪要" } });
    fireEvent.change(screen.getByLabelText("笔记内容"), { target: { value: "检索评测" } });
    fireEvent.click(screen.getByRole("button", { name: "创建笔记" }));
    await waitFor(() => expect(p.onCreateText).toHaveBeenCalledWith("会议纪要", "检索评测", "redacted", 3, null));
  });
  it("trashes reversibly and confirms permanent deletion", async () => {
    const p = props();
    const view = render(<LibraryPage {...p} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 读书笔记" }));
    fireEvent.click(screen.getByRole("button", { name: "更多文件操作" }));
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
    expect(p.onUseForChat).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "用于新对话" })).toHaveTextContent("不会开启长期使用");
    fireEvent.click(screen.getByRole("button", { name: "创建对话" }));
    await waitFor(() => expect(p.onUseForChat).toHaveBeenCalledWith([8, 7]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "选择当前全部文件" }));
    fireEvent.click(screen.getByRole("button", { name: "更多文件操作" }));
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
    fireEvent.click(screen.getByRole("button", { name: "知识" }));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByLabelText("待确认内容")).toHaveTextContent("主导过检索评测");
    expect(screen.queryByLabelText("称呼")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "文件库更多选项" }));
    fireEvent.click(screen.getByRole("button", { name: "文件库设置" }));
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
  it("combines directory, origin, knowledge status and content search", async () => {
    const p = props();
    const files: LibrarySource[] = [
      { ...source, folder_id: 3 },
      { ...source, id: 8, title: "对话纪要", folder_id: 3, source_kind: "upload", source_uri: "chat:1:2", enabled: false },
      { ...source, id: 9, title: "其他目录", folder_id: null, source_kind: "upload", source_uri: "chat:1:3", enabled: false }
    ];
    const search = vi.fn().mockResolvedValue(files);
    render(<LibraryPage {...p} sources={files} onSearchSources={search} />);
    fireEvent.click(screen.getByRole("button", { name: "项目资料" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.change(screen.getByLabelText("筛选来源"), { target: { value: "chat" } });
    fireEvent.change(screen.getByLabelText("筛选 AI 使用"), { target: { value: "archive" } });
    fireEvent.change(screen.getByLabelText("搜索文件名或内容"), { target: { value: "正文关键词" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("正文关键词"));
    expect(await screen.findByText("对话纪要")).toBeInTheDocument();
    expect(screen.queryByText("读书笔记")).not.toBeInTheDocument();
    expect(screen.queryByText("其他目录")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByText("读书笔记")).toBeInTheDocument();
    expect(screen.getByLabelText("搜索文件名或内容")).toHaveValue("正文关键词");
  });
  it("clears selections when a filter hides their files", () => {
    render(<LibraryPage {...props()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 读书笔记" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.change(screen.getByLabelText("筛选来源"), { target: { value: "chat" } });
    expect(screen.queryByText("已选 1 个文件")).not.toBeInTheDocument();
    expect(screen.getByText("没有找到匹配的文件")).toBeInTheDocument();
  });
  it("keeps files without text archived and blocks text-dependent batch actions", () => {
    render(<LibraryPage {...props()} sources={[{ ...source, character_count: 0, text_parse_status: "not_required", enabled: false }]} />);
    expect(within(screen.getByRole("table", { name: "文件列表" })).getByText("无可检索正文")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 读书笔记" }));
    expect(screen.getByRole("button", { name: "用于对话" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "更多文件操作" }));
    expect(screen.getByRole("button", { name: "开启长期使用" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("补充 AI 读取内容");
    expect(screen.getByRole("button", { name: "下载" })).not.toBeDisabled();
  });
  it("enables selected readable archives as knowledge sources explicitly", async () => {
    const p = props();
    render(<LibraryPage {...p} sources={[{ ...source, enabled: false }]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 读书笔记" }));
    fireEvent.click(screen.getByRole("button", { name: "更多文件操作" }));
    fireEvent.click(screen.getByRole("button", { name: "开启长期使用" }));
    await waitFor(() => expect(p.onUpdateSource).toHaveBeenCalledWith(7, { enabled: true }));
  });
  it("separates confirmed knowledge from pending proposals and links to usable files", async () => {
    const p = props();
    const confirmed = [{ id: 30, category: "knowledge", statement: "已确认的阅读偏好", status: "confirmed" as const }];
    render(<LibraryPage {...p} confirmedFacts={confirmed} pendingFacts={[{ id: 21, statement: "待确认偏好" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "知识" }));
    expect(screen.getByLabelText("已确认知识")).toHaveTextContent("已确认的阅读偏好");
    expect(screen.getByLabelText("待确认内容")).toHaveTextContent("待确认偏好");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看长期资料" }));
    expect(screen.getByText("长期使用", { selector: ".fl-filter-summary span" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    expect(screen.getByLabelText("筛选 AI 使用")).toHaveValue("ready");
    expect(screen.getByText("读书笔记")).toBeInTheDocument();
  });

  it("filters shared files by topic and removes membership without deleting or disabling", async () => {
    const p = props();
    render(<LibraryPage {...p} sources={[source, { ...source, id: 8, title: "集合外文件" }]}
      collections={[{ id: 10, name: "阅读", source_ids: [7], file_count: 1 }, { id: 11, name: "研究", source_ids: [7], file_count: 1 }]} />);
    fireEvent.change(screen.getByLabelText("选择主题集合"), { target: { value: "10" } });
    expect(screen.queryByText("集合外文件")).not.toBeInTheDocument();
    expect(screen.getByText("读书笔记")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 读书笔记" }));
    fireEvent.click(screen.getByRole("button", { name: "更多文件操作" }));
    fireEvent.click(screen.getByRole("button", { name: "移出当前集合" }));
    await waitFor(() => expect(p.onUpdateCollectionSources).toHaveBeenCalledWith(10, [7], "remove"));
    expect(p.onDeleteSource).not.toHaveBeenCalled();
    expect(p.onUpdateSource).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("选择主题集合"), { target: { value: "11" } });
    expect(screen.getByText("读书笔记")).toBeInTheDocument();
    expect(screen.queryByText("已选 1 个文件")).not.toBeInTheDocument();
  });

  it("creates collections and joins selected archives without enabling AI use", async () => {
    const p = props();
    render(<LibraryPage {...p} sources={[{ ...source, enabled: false }]}
      collections={[{ id: 10, name: "阅读", source_ids: [], file_count: 0 }]} />);
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    fireEvent.click(screen.getByRole("button", { name: "新建主题集合" }));
    fireEvent.change(screen.getByLabelText("主题集合名称"), { target: { value: "研究资料" } });
    fireEvent.click(screen.getByRole("button", { name: "新建主题集合" }));
    await waitFor(() => expect(p.onCreateCollection).toHaveBeenCalledWith("研究资料"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 读书笔记" }));
    fireEvent.click(screen.getByRole("button", { name: "更多文件操作" }));
    fireEvent.click(screen.getByRole("button", { name: "加入主题集合" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "加入主题集合" }));
    await waitFor(() => expect(p.onUpdateCollectionSources).toHaveBeenCalledWith(10, [7], "add"));
    expect(p.onUpdateSource).not.toHaveBeenCalled();
  });

  it("retains selections and error feedback when collection membership fails", async () => {
    const p = props();
    p.onUpdateCollectionSources.mockRejectedValue(new Error("集合保存失败"));
    render(<LibraryPage {...p} collections={[{ id: 10, name: "阅读", source_ids: [], file_count: 0 }]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 读书笔记" }));
    fireEvent.click(screen.getByRole("button", { name: "更多文件操作" }));
    fireEvent.click(screen.getByRole("button", { name: "加入主题集合" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "加入主题集合" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("集合保存失败");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 读书笔记" })).toBeChecked();
  });

  it("creates a first collection with selected files in one step", async () => {
    const p = props();
    render(<LibraryPage {...p} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 读书笔记" }));
    fireEvent.click(screen.getByRole("button", { name: "更多文件操作" }));
    fireEvent.click(screen.getByRole("button", { name: "加入主题集合" }));
    expect(screen.getByLabelText("目标主题集合")).toHaveValue("new");
    fireEvent.change(screen.getByLabelText("主题集合名称"), { target: { value: "我的阅读" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "加入主题集合" }));
    await waitFor(() => expect(p.onCreateCollection).toHaveBeenCalledWith("我的阅读", [7]));
    expect(p.onUpdateSource).not.toHaveBeenCalled();
    expect(p.onUpdateCollectionSources).not.toHaveBeenCalled();
  });

  it("deletes only the selected collection after explaining that files remain", async () => {
    const p = props();
    render(<LibraryPage {...p} collections={[{ id: 10, name: "阅读", source_ids: [7], file_count: 1 }]} />);
    fireEvent.change(screen.getByLabelText("选择主题集合"), { target: { value: "10" } });
    fireEvent.click(screen.getByLabelText("主题集合操作"));
    fireEvent.click(screen.getByRole("button", { name: "删除集合" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("文件和长期使用设置都会保留");
    expect(p.onDeleteCollection).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除主题集合" }));
    await waitFor(() => expect(p.onDeleteCollection).toHaveBeenCalledWith(10));
    expect(p.onDeleteSource).not.toHaveBeenCalled();
    expect(p.onUpdateSource).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("选择主题集合")).toHaveValue("all"));
  });

  it("blocks chat batches beyond the send limit and exposes long-term use in preview", async () => {
    const p = props();
    const view = render(<LibraryPage {...p} sources={Array.from({ length: 9 }, (_, i) => ({ ...source, id: i + 7, title: `资料${i}` }))} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择当前全部文件" }));
    expect(screen.getByRole("button", { name: "用于对话" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("最多带入 8 个文件");
    view.rerender(<LibraryPage {...p} sources={[source]} />);
    const pane = await preview();
    fireEvent.click(within(pane).getByRole("checkbox", { name: "长期使用" }));
    await waitFor(() => expect(p.onUpdateSource).toHaveBeenCalledWith(7, { enabled: false }));
  });

});
