import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RunStatus } from "./RunStatus";
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("shows elapsed wait without resetting when the stage changes", () => {
  vi.useFakeTimers();
  const view = render(<RunStatus title="正在搜索" />);
  expect(screen.getByRole("status")).toHaveTextContent("正在搜索");
  expect(screen.queryByLabelText("本次页面等待时间")).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(12000));
  view.rerender(<RunStatus title="正在生成回复" />);
  expect(screen.getByLabelText("本次页面等待时间")).toHaveTextContent("12 秒");
  act(() => vi.advanceTimersByTime(50000));
  expect(screen.getByLabelText("本次页面等待时间")).toHaveTextContent("1 分 2 秒");
});
