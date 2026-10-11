import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatWorkspaceMermaid } from "./ChatWorkspaceMermaid";

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(), downloadText: vi.fn() }));
vi.mock("mermaid", () => ({ default: { initialize: mocks.initialize, render: mocks.render } }));
vi.mock("../features/chat/result-files", () => ({ downloadText: mocks.downloadText }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const source = "flowchart LR\nA-->B\n";

it("downloads source even before rendering, then exports the rendered SVG", async () => {
  mocks.render.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><text>A</text></svg>' });
  render(<ChatWorkspaceMermaid source={source} />);
  fireEvent.click(screen.getByRole("button", { name: "下载源码" }));
  expect(mocks.downloadText).toHaveBeenCalledWith(source.trimEnd(), "图表.mmd");
  const svg = screen.getByRole("button", { name: "下载 SVG" });
  await waitFor(() => expect(svg).toBeEnabled());
  fireEvent.click(svg);
  expect(mocks.downloadText).toHaveBeenLastCalledWith(expect.stringContaining('xmlns="http://www.w3.org/2000/svg"'), "图表.svg", "image/svg+xml");
});

it("retains source download when rendering fails and disables SVG export", async () => {
  mocks.render.mockRejectedValue(new Error("bad syntax"));
  render(<ChatWorkspaceMermaid source="not a diagram" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法显示");
  expect(screen.getByRole("button", { name: "下载 SVG" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "下载源码" }));
  expect(mocks.downloadText).toHaveBeenCalledWith("not a diagram", "图表.mmd");
});

it("does not offer final downloads during generation", () => {
  render(<ChatWorkspaceMermaid source={source} streaming />);
  expect(screen.queryByRole("button", { name: "下载 SVG" })).not.toBeInTheDocument();
  expect(mocks.render).not.toHaveBeenCalled();
});
