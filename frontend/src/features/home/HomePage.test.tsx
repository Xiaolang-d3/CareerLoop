import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";
import { homeInboxItems } from "./home-metrics";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("home-metrics", () => {
  it("keeps generic proposals and source evidence for the library review", () => {
    expect(
      homeInboxItems([
        { id: 1, statement: "每天记录问题", evidence: [{ excerpt: "原始阅读笔记", source_title: "笔记" }] }
      ])
    ).toEqual([expect.objectContaining({ id: 1, title: "每天记录问题", source: "原始阅读笔记", sourceLabel: "笔记" })]);
  });
});

describe("HomePage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 8, 11, 59, 59));
  });

  it("shows only the current local time and welcome without action entries", () => {
    render(<HomePage />);
    expect(screen.getByLabelText("当前时间")).toHaveTextContent("11:59");
    expect(screen.getByRole("heading")).toHaveTextContent("早上好，欢迎回来");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("资料概览")).not.toBeInTheDocument();
    expect(screen.queryByText("最近对话")).not.toBeInTheDocument();
  });

  it("updates the clock and welcome as the time of day changes", () => {
    render(<HomePage />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByLabelText("当前时间")).toHaveTextContent("12:00");
    expect(screen.getByRole("heading")).toHaveTextContent("下午好，欢迎回来");
    vi.setSystemTime(new Date(2026, 9, 8, 17, 59, 59));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByLabelText("当前时间")).toHaveTextContent("18:00");
    expect(screen.getByRole("heading")).toHaveTextContent("晚上好，欢迎回来");
  });

  it("resynchronizes after returning to the page and cleans up the timer on unmount", () => {
    const { unmount } = render(<HomePage />);
    vi.setSystemTime(new Date(2026, 9, 9, 8, 30));
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByLabelText("当前时间")).toHaveTextContent("08:30");
    expect(screen.getByRole("heading")).toHaveTextContent("早上好，欢迎回来");
    vi.setSystemTime(new Date(2026, 9, 9, 9, 10));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(screen.getByLabelText("当前时间")).toHaveTextContent("09:10");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
