import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppTopBar } from "./AppTopBar";
import { topbarSectionForPage } from "../constants";

function renderTopBar(overrides: Partial<Parameters<typeof AppTopBar>[0]> = {}) {
  const props = {
    section: topbarSectionForPage("settings", "模型设置"),
    title: "模型设置",
    ...overrides
  };
  render(<AppTopBar {...props} />);
  return props;
}

describe("AppTopBar", () => {
  afterEach(cleanup);

  it("shows the page title without creating another account entry", () => {
    renderTopBar();
    expect(screen.getByRole("heading", { level: 1, name: "模型设置" })).toBeInTheDocument();
    expect(screen.queryByText("设置")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "账号菜单" })).not.toBeInTheDocument();
  });

  it("shows only the current conversation title for chat", () => {
    renderTopBar({ section: topbarSectionForPage("chat", "新对话"), title: "新对话" });
    expect(screen.getByRole("heading", { level: 1, name: "新对话" })).toBeInTheDocument();
    expect(screen.queryByText("对话")).not.toBeInTheDocument();
  });

  it("renames the current conversation from the chat title", () => {
    const onTitleClick = vi.fn();
    renderTopBar({ title: "新对话", section: undefined, onTitleClick, titleClickLabel: "重命名对话" });
    fireEvent.click(screen.getByRole("button", { name: "重命名对话" }));
    expect(onTitleClick).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { level: 1, name: "新对话" })).toBeInTheDocument();
  });

  it("renders explicit page actions when supplied", () => {
    const onRefresh = vi.fn();
    renderTopBar({ children: <button onClick={onRefresh}>刷新</button> });
    const action = screen.getByRole("button", { name: "刷新" });
    expect(action.closest(".app-topbar-actions")).toBeTruthy();
    fireEvent.click(action);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("does not leave an empty bar when both title and actions are absent", () => {
    const { container } = render(<AppTopBar />);
    expect(container).toBeEmptyDOMElement();
  });
});
