import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

function BrokenPage(): never {
  throw new Error("测试渲染错误");
}

describe("AppErrorBoundary", () => {
  afterEach(cleanup);

  it("shows a recoverable error screen instead of leaving the application blank", () => {
    render(<AppErrorBoundary><BrokenPage /></AppErrorBoundary>);

    expect(screen.getByRole("alert")).toHaveTextContent("页面暂时无法显示");
    expect(screen.getByText("测试渲染错误")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新页面" })).toBeInTheDocument();
  });
});
