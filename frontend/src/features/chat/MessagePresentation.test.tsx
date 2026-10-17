import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatContextChips, ResearchPanel } from "./MessagePresentation";

afterEach(cleanup);

it("does not reserve composer space for saved materials alone", () => {
  const view = render(<ChatContextChips context={{ sourceLabel: "阅读笔记", analysisLabel: null }} />);
  expect(view.container).toBeEmptyDOMElement();
});

it("shows source headings as direct links without summary controls", () => {
  render(<ResearchPanel open sources={[
    { title: "公开资料", url: "https://example.com/first", snippet: "来源摘要" },
    { title: "另一份资料", url: "https://example.com/second", snippet: "第二份摘要" }
  ]} selectedSource={0} streaming={false} onClose={vi.fn()} />);
  for (const [title, url] of [["公开资料", "https://example.com/first"], ["另一份资料", "https://example.com/second"]]) {
    const link = screen.getByRole("link", { name: title });
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(link.closest("button")).toBeNull();
  }
  expect(screen.queryByRole("button", { name: /^来源 \d/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /展开摘要|收起摘要/ })).not.toBeInTheDocument();
  expect(screen.queryByText("来源摘要")).not.toBeInTheDocument();
  expect(screen.queryByText("第二份摘要")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /打开原网页/ })).not.toBeInTheDocument();
});

it("keeps selected sources compact when switching citations and reopening the panel", () => {
  const summary = `${"这是可核对的公开资料摘要。".repeat(20)}摘要结尾`;
  const sources = [
    { title: "公开资料", url: "https://example.com/first", snippet: summary },
    { title: "简短资料", url: "https://example.com/second", snippet: "一段简短摘要。" }
  ];
  const props = {
    open: true,
    sources,
    selectedSource: 0,
    streaming: false,
    onClose: vi.fn()
  };
  const view = render(<ResearchPanel {...props} />);
  expect(screen.getByRole("link", { name: "公开资料" })).toBeVisible();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  expect(screen.queryByText(/这是可核对的公开资料摘要/)).not.toBeInTheDocument();
  view.rerender(<ResearchPanel {...props} selectedSource={1} />);
  expect(screen.getByRole("link", { name: "简短资料" })).toBeVisible();
  expect(screen.queryByText("一段简短摘要。")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /展开摘要|收起摘要/ })).not.toBeInTheDocument();
  view.rerender(<ResearchPanel {...props} open={false} />);
  expect(screen.queryByRole("complementary", { name: "来源详情" })).not.toBeInTheDocument();
  view.rerender(<ResearchPanel {...props} selectedSource={0} />);
  expect(screen.getByRole("link", { name: "公开资料" })).toBeVisible();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
});
