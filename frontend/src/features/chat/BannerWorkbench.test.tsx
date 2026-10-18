import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BannerWorkbench, type BannerImageEntry } from "./BannerWorkbench";
import { downloadBlob } from "./result-files";
// @ts-expect-error The application tsconfig is browser-only; Vitest supplies Node APIs.
import { readFileSync } from "node:fs";
const workingDirectory = (globalThis as typeof globalThis & { process: { cwd(): string } }).process.cwd();
const stylesheet = readFileSync(`${workingDirectory}/src/features/chat/banner-workbench.css`, "utf8") as string;

vi.mock("./result-files", () => ({ downloadBlob: vi.fn() }));

beforeEach(() => {
  let serial = 0;
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: vi.fn(() => `blob:local-${++serial}`), revokeObjectURL: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("follows newly arrived candidates until the user explicitly selects an older scheme", () => {
  const props = { open: true, entries: [images[0]], onUsePrompt: vi.fn(), onClose: vi.fn() };
  const view = render(<BannerWorkbench {...props} />);
  view.rerender(<BannerWorkbench {...props} entries={images} />);
  expect(screen.getByRole("button", { name: "选择方案 2：方案 B.png" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "选择方案 1：方案 A.png" }));
  view.rerender(<BannerWorkbench {...props} entries={[...images, { ...images[1], messageId: 13, asset: { ...images[1].asset, id: "image-c", original_filename: "方案 C.png" } }]} />);
  expect(screen.getByRole("button", { name: "选择方案 1：方案 A.png" })).toHaveAttribute("aria-pressed", "true");
  expect(props.onUsePrompt).not.toHaveBeenCalled();
});

it("keeps the image first and reveals the editable brief only when requested", () => {
  render(<BannerWorkbench open entries={images} onUsePrompt={vi.fn()} onClose={vi.fn()} />);
  expect(screen.queryByRole("textbox", { name: "主题与用途" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "编辑需求" }));
  fireEvent.change(screen.getByRole("textbox", { name: "主题与用途" }), { target: { value: "新的会员活动" } });
  fireEvent.click(screen.getByRole("button", { name: "编辑需求" }));
  expect(screen.queryByRole("textbox", { name: "主题与用途" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "编辑需求" }));
  expect(screen.getByRole("textbox", { name: "主题与用途" })).toHaveValue("新的会员活动");
});

it("switches canvas views without losing the brief or starting generation", () => {
  const usePrompt = vi.fn();
  render(<BannerWorkbench open entries={[]} onUsePrompt={usePrompt} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("主题与用途"), { target: { value: "会员招募" } });
  expect(screen.getByRole("tab", { name: "原图" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("tab", { name: "页面预览" }));
  expect(screen.getByRole("region", { name: "页面排版预览" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "当前方案" })).not.toBeInTheDocument();
  const comparisonTab = screen.getByRole("tab", { name: "候选对比" });
  comparisonTab.focus();
  fireEvent.keyDown(comparisonTab, { key: "Home" });
  expect(screen.getByRole("tab", { name: "原图" })).toHaveFocus();
  expect(screen.getByLabelText("主题与用途")).toHaveValue("会员招募");
  expect(usePrompt).not.toHaveBeenCalled();
});

it("provides a bounded, token-themed split panel with a narrow-screen stacked layout", () => {
  const view = render(<BannerWorkbench open entries={[]} onUsePrompt={vi.fn()} onClose={vi.fn()} />);
  expect(view.container.querySelector(".banner-workbench-body")).toBeInTheDocument();
  expect(stylesheet).toMatch(/\.banner-workbench\s*\{[^}]*flex:\s*1 1 0/);
  expect(stylesheet).toMatch(/\.banner-workbench\s*\{[^}]*min-width:\s*0/);
  expect(stylesheet).toMatch(/\.banner-workbench\s*\{[^}]*min-height:\s*0/);
  expect(stylesheet).toContain("var(--color-surface)");
  expect(stylesheet).toContain("var(--color-text)");
  expect(stylesheet).toContain("@media (max-width: 760px)");
  expect(stylesheet).toMatch(/\.banner-page-preview\s*\{[^}]*position:\s*relative/);
});

const images: BannerImageEntry[] = [
  { asset: { id: "image-a", kind: "image", origin: "generated", original_filename: "方案 A.png", parse_status: "parsed", width: 1536, height: 1024, model_name: "image-model" }, messageId: 11, prompt: "第一轮：紫色抽象主体" },
  { asset: { id: "image-b", kind: "image", origin: "generated", original_filename: "方案 B.png", parse_status: "parsed", width: 1024, height: 1024 }, messageId: 12, prompt: "第二轮：柔和纸雕" },
];

it("loads real images privately, compares separate-message candidates, shows lineage and downloads the exact selected original", async () => {
  const originals = [new Blob(["original-a"], { type: "image/png" }), new Blob(["original-b"], { type: "image/png" })];
  const load = vi.fn(async (asset: { id: string }) => ({ file: originals[asset.id === "image-a" ? 0 : 1] }));
  const props = { open: true, entries: images, loadOriginal: load, onUsePrompt: vi.fn(), onClose: vi.fn() };
  const view = render(<BannerWorkbench {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "选择方案 1：方案 A.png" }));
  await waitFor(() => expect(screen.getByRole("img", { name: "当前方案：方案 A.png" })).toHaveAttribute("src", "blob:local-1"));
  expect(load).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenCalledWith(images[0].asset, expect.any(AbortSignal));
  fireEvent.click(screen.getByRole("tab", { name: "候选对比" }));
  expect(screen.getByRole("region", { name: "候选对比" })).toContainElement(screen.getByRole("img", { name: "对比方案：方案 A.png" }));
  expect(screen.getByRole("region", { name: "候选对比" })).toContainElement(screen.getByRole("img", { name: "对比方案：方案 B.png" }));
  expect(screen.getAllByText(/1536 × 1024/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/image-model/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("tab", { name: "原图" }));
  expect(screen.getByText(images[0].prompt)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "选择方案 2：方案 B.png" }));
  expect(screen.getByRole("img", { name: "当前方案：方案 B.png" })).toHaveAttribute("src", "blob:local-2");
  expect(screen.getByText(images[1].prompt)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "下载原图" }));
  expect(downloadBlob).toHaveBeenCalledWith(originals[1], "方案 B.png");
  view.rerender(<BannerWorkbench {...props} entries={images.map(entry => ({ ...entry }))} loadOriginal={asset => load(asset)} />);
  expect(load).toHaveBeenCalledTimes(2);
  view.rerender(<BannerWorkbench {...props} open={false} />);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-1");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-2");
  view.rerender(<BannerWorkbench {...props} />);
  await waitFor(() => expect(screen.getByRole("img", { name: "当前方案：方案 B.png" })).toBeInTheDocument());
});

it("distinguishes candidates that share the provider's default filename", () => {
  const entries = images.map(entry => ({ ...entry, asset: { ...entry.asset, original_filename: "生成图片-1.png" } }));
  render(<BannerWorkbench open entries={entries} onUsePrompt={vi.fn()} onClose={vi.fn()} />);
  const second = screen.getByRole("button", { name: "选择方案 2：生成图片-1.png" });
  fireEvent.click(second);
  expect(second).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(images[1].prompt)).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "对比方案 1：生成图片-1.png" })).toBeChecked();
});

it("labels decoded original dimensions rather than treating the requested aspect ratio as output size", async () => {
  const entry = { ...images[0], asset: { ...images[0].asset, width: undefined, height: undefined } };
  const load = vi.fn().mockResolvedValue({ file: new Blob(["real-original"], { type: "image/png" }) });
  render(<BannerWorkbench open entries={[entry]} loadOriginal={load} onUsePrompt={vi.fn()} onClose={vi.fn()} />);
  const image = await screen.findByRole("img", { name: "当前方案：方案 A.png" });
  Object.defineProperties(image, { naturalWidth: { value: 1280 }, naturalHeight: { value: 720 } });
  fireEvent.load(image);
  expect(screen.getAllByText(/1280 × 720 px/).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText("目标比例"), { target: { value: "1:1" } });
  expect(screen.getAllByText(/1280 × 720 px/).length).toBeGreaterThan(0);
  expect(load).toHaveBeenCalledOnce();
});

it("reports private-load failures and retries without changing the brief", async () => {
  const blob = new Blob(["recovered"], { type: "image/png" });
  const load = vi.fn().mockRejectedValueOnce(new Error("private backend detail")).mockResolvedValue({ file: blob });
  render(<BannerWorkbench open entries={[images[0]]} loadOriginal={load} onUsePrompt={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("主题与用途"), { target: { value: "春日" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("原图加载失败");
  expect(screen.queryByText("private backend detail")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下载原图" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重试加载方案 A.png" }));
  await screen.findByRole("img", { name: "当前方案：方案 A.png" });
  expect(load).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("主题与用途")).toHaveValue("春日");
  fireEvent.error(screen.getByRole("img", { name: "当前方案：方案 A.png" }));
  expect(screen.getByRole("alert")).toHaveTextContent("图片无法显示");
  // Even an undecodable original remains downloadable byte-for-byte.
  fireEvent.click(screen.getByRole("button", { name: "下载原图" }));
  expect(downloadBlob).toHaveBeenCalledWith(blob, images[0].asset.original_filename);
});

it("does not load when closed and aborts late results on close and unmount", async () => {
  const pending: Array<{ resolve: (value: { file: Blob }) => void; signal: AbortSignal }> = [];
  const load = vi.fn((_asset: BannerImageEntry["asset"], signal?: AbortSignal) => new Promise<{ file: Blob }>(resolve => pending.push({ resolve, signal: signal! })));
  const props = { entries: [images[0]], loadOriginal: load, onUsePrompt: vi.fn(), onClose: vi.fn() };
  const view = render(<BannerWorkbench {...props} open={false} />);
  expect(load).not.toHaveBeenCalled();
  view.rerender(<BannerWorkbench {...props} open />);
  await waitFor(() => expect(pending).toHaveLength(1));
  view.rerender(<BannerWorkbench {...props} open={false} />);
  expect(pending[0].signal.aborted).toBe(true);
  await act(async () => pending[0].resolve({ file: new Blob(["late"]) }));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  view.rerender(<BannerWorkbench {...props} open />);
  await waitFor(() => expect(pending).toHaveLength(2));
  view.unmount();
  expect(pending[1].signal.aborted).toBe(true);
  await act(async () => pending[1].resolve({ file: new Blob(["later"]) }));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(downloadBlob).not.toHaveBeenCalled();
});

it("uses a local screenshot for adjustable CSS placement only, never uploads it, and revokes local URLs", async () => {
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  const load = vi.fn().mockResolvedValue({ file: new Blob(["banner"], { type: "image/png" }) });
  const props = { entries: [images[0]], loadOriginal: load, onUsePrompt: vi.fn(), onClose: vi.fn() };
  const view = render(<BannerWorkbench {...props} open />);
  await screen.findByRole("img", { name: "当前方案：方案 A.png" });
  fireEvent.click(screen.getByRole("tab", { name: "页面预览" }));
  expect(screen.getByText(/页面截图仅用于本地排版预览，不会发送给生图模型/)).toBeInTheDocument();
  expect(screen.getByText(/通用页面示意，非原始页面/)).toBeInTheDocument();
  const input = screen.getByLabelText("上传页面截图");
  expect(input).toHaveAttribute("accept", "image/png,image/jpeg,image/webp");
  fireEvent.change(input, { target: { files: [new File(["local-only"], "page.png", { type: "image/png" })] } });
  const page = await screen.findByRole("img", { name: "本地页面截图" });
  const pageUrl = page.getAttribute("src");
  expect(pageUrl).toBe("blob:local-2");
  expect(load).toHaveBeenCalledTimes(1);
  expect(network).not.toHaveBeenCalled();
  expect(props.onUsePrompt).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("宽度（%）"), { target: { value: "60" } });
  fireEvent.change(screen.getByLabelText("横向位置（%）"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("纵向位置（%）"), { target: { value: "25" } });
  fireEvent.change(screen.getByLabelText("高度（%）"), { target: { value: "20" } });
  expect(screen.getByRole("img", { name: "页面中的 Banner 排版预览" })).toHaveStyle({ left: "12%", top: "25%", width: "60%", height: "20%", objectFit: "cover" });
  expect(screen.getByText(/仅为本地 CSS 排版预览，不会修改或导出合成图片/)).toBeInTheDocument();
  view.rerender(<BannerWorkbench {...props} open={false} />);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(pageUrl);
  view.rerender(<BannerWorkbench {...props} open />);
  await screen.findByRole("img", { name: "本地页面截图" });
  fireEvent.click(screen.getByRole("button", { name: "移除页面截图" }));
  expect(screen.queryByRole("img", { name: "本地页面截图" })).not.toBeInTheDocument();
  expect(screen.getByText(/通用页面示意，非原始页面/)).toBeInTheDocument();
});

it("opens the selected original in the existing full image viewer without preparing generation", async () => {
  const preview = vi.fn(), prepare = vi.fn();
  render(<BannerWorkbench open entries={[images[0]]} loadOriginal={vi.fn().mockResolvedValue({ file: new Blob(["image"], { type: "image/png" }) })} onUsePrompt={prepare} onClose={vi.fn()} onPreviewImage={preview} />);
  await screen.findByRole("img", { name: "当前方案：方案 A.png" });
  fireEvent.click(screen.getByRole("button", { name: "放大查看" }));
  expect(preview).toHaveBeenCalledWith(images[0].asset);
  expect(prepare).not.toHaveBeenCalled();
});

it("applies placement presets and crop mode locally and can restore the default layout", async () => {
  const usePrompt = vi.fn();
  render(<BannerWorkbench open entries={[images[0]]} loadOriginal={vi.fn().mockResolvedValue({ file: new Blob(["image"], { type: "image/png" }) })} onUsePrompt={usePrompt} onClose={vi.fn()} />);
  await screen.findByRole("img", { name: "当前方案：方案 A.png" });
  fireEvent.click(screen.getByRole("tab", { name: "页面预览" }));
  fireEvent.click(screen.getByRole("button", { name: "顶部通栏" }));
  expect(screen.getByRole("img", { name: "页面中的 Banner 排版预览" })).toHaveStyle({ left: "0%", top: "8%", width: "100%", height: "24%" });
  fireEvent.change(screen.getByLabelText("图片适配"), { target: { value: "contain" } });
  expect(screen.getByRole("img", { name: "页面中的 Banner 排版预览" })).toHaveStyle({ objectFit: "contain" });
  fireEvent.click(screen.getByRole("button", { name: "恢复默认排版" }));
  expect(screen.getByRole("img", { name: "页面中的 Banner 排版预览" })).toHaveStyle({ left: "5%", top: "18%", width: "90%", height: "30%", objectFit: "cover" });
  expect(usePrompt).not.toHaveBeenCalled();
});

it("rejects unsupported, empty, oversized and undecodable local screenshot files", async () => {
  render(<BannerWorkbench open entries={[]} onUsePrompt={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: "页面预览" }));
  const input = screen.getByLabelText("上传页面截图");
  fireEvent.change(input, { target: { files: [new File(["<svg/>"], "page.svg", { type: "image/svg+xml" })] } });
  expect(screen.getByRole("alert")).toHaveTextContent("PNG、JPEG 或 WebP");
  fireEvent.change(input, { target: { files: [new File([], "empty.png", { type: "image/png" })] } });
  expect(screen.getByRole("alert")).toHaveTextContent("空文件");
  const oversized = new File(["x"], "large.jpg", { type: "image/jpeg" });
  Object.defineProperty(oversized, "size", { value: 10 * 1024 * 1024 + 1 });
  fireEvent.change(input, { target: { files: [oversized] } });
  expect(screen.getByRole("alert")).toHaveTextContent("10 MB");
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { files: [new File(["invalid"], "broken.webp", { type: "image/webp" })] } });
  fireEvent.error(await screen.findByRole("img", { name: "本地页面截图" }));
  expect(screen.getByRole("alert")).toHaveTextContent("无法读取页面截图");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-1");
});

it("prepares one text-free image prompt from the brief, without generating anything", () => {
  const usePrompt = vi.fn(), load = vi.fn();
  render(<BannerWorkbench open entries={[]} loadOriginal={load} onUsePrompt={usePrompt} onClose={() => {}} />);
  expect(screen.getByRole("region", { name: "Banner 设计台" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "准备生图指令" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("主题与用途"), { target: { value: "春日会员活动，首页招募" } });
  fireEvent.change(screen.getByLabelText("视觉风格"), { target: { value: "柔和 3D" } });
  fireEvent.change(screen.getByLabelText("主色与配色"), { target: { value: "紫色与奶白" } });
  fireEvent.change(screen.getByLabelText("目标比例"), { target: { value: "3:1" } });
  fireEvent.change(screen.getByLabelText("文案安全区"), { target: { value: "right" } });
  fireEvent.click(screen.getByRole("button", { name: "准备生图指令" }));
  expect(usePrompt).toHaveBeenCalledOnce();
  const prompt = usePrompt.mock.calls[0][0] as string;
  expect(prompt.split("\n")[0]).toBe("帮我生成一张图片：用于界面的 Banner。");
  expect(screen.getByRole("region", { name: "Banner 设计台" })).toHaveAttribute("id", "banner-design-workbench");
  for (const text of ["仅生成一张", "春日会员活动，首页招募", "柔和 3D", "紫色与奶白", "3:1", "右侧", "左侧", "不要", "文字"]) expect(prompt).toContain(text);
  expect(load).not.toHaveBeenCalled();
  expect(screen.getByText("新方案会重新生成，不会局部修改原图")).toBeInTheDocument();
  expect(screen.getByText(/实际输出尺寸可能不同/)).toBeInTheDocument();
});

it("reuses the selected historical request for a new direction without requiring a reconstructed brief", () => {
  const usePrompt = vi.fn();
  render(<BannerWorkbench open entries={[images[0]]} onUsePrompt={usePrompt} onClose={vi.fn()} />);
  expect(screen.getByLabelText("主题与用途")).toHaveValue("");
  const alternate = screen.getByRole("button", { name: "另出一个方向" });
  expect(alternate).toBeEnabled();
  fireEvent.click(alternate);
  const prompt = usePrompt.mock.calls[0][0] as string;
  expect(prompt).toMatch(/^帮我生成一张图片/);
  expect(prompt).toContain(images[0].prompt);
  expect(prompt).toContain("新图");
  expect(prompt).toContain("不是原图的局部编辑");
});

it("keeps the brief across parent rerenders and closing, restores focus on Escape, and prepares a different direction", () => {
  const close = vi.fn(), usePrompt = vi.fn();
  const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
  const props = { entries: [], onUsePrompt: usePrompt, onClose: close };
  const view = render(<BannerWorkbench {...props} open />);
  fireEvent.change(screen.getByLabelText("主题与用途"), { target: { value: "会员活动" } });
  fireEvent.change(screen.getByLabelText("视觉风格"), { target: { value: "纸雕" } });
  view.rerender(<BannerWorkbench {...props} onClose={() => close()} open />);
  fireEvent.click(screen.getByRole("button", { name: "另出一个方向" }));
  expect(usePrompt.mock.calls[0][0]).toContain("会员活动");
  expect(usePrompt.mock.calls[0][0]).toContain("纸雕");
  expect(usePrompt.mock.calls[0][0]).toContain("不同");
  fireEvent.keyDown(screen.getByLabelText("主题与用途"), { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
  view.rerender(<BannerWorkbench {...props} open={false} />);
  expect(screen.queryByRole("region", { name: "Banner 设计台" })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  view.rerender(<BannerWorkbench {...props} open busy />);
  expect(screen.getByLabelText("主题与用途")).toHaveValue("会员活动");
  expect(screen.getByLabelText("视觉风格")).toHaveValue("纸雕");
  expect(screen.getByRole("button", { name: "另出一个方向" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "准备生图指令" })).toBeDisabled();
  trigger.remove();
});
