import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatWorkspaceMindmap } from "./ChatWorkspaceMindmap";

const source = `mindmap
  root((求职准备))
    简历
      项目经历
    面试
      常见问题`;

describe("ChatWorkspaceMindmap", () => {
  afterEach(cleanup);

  it("renders an expandable map instead of a static image", () => {
    render(<ChatWorkspaceMindmap source={source} />);

    expect(screen.getByTestId("interactive-mindmap")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /求职准备/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /简历/ })).toBeInTheDocument();
    expect(screen.queryByText("项目经历")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /简历/ }));
    expect(screen.getByText("项目经历")).toBeInTheDocument();
  });

  it("expands and collapses all branches from the toolbar", () => {
    render(<ChatWorkspaceMindmap source={source} />);

    fireEvent.click(screen.getByRole("button", { name: "收起分支" }));
    expect(screen.queryByRole("button", { name: /简历/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开全部" }));
    expect(screen.getByText("项目经历")).toBeInTheDocument();
    expect(screen.getByText("常见问题")).toBeInTheDocument();
  });

  it("opens an in-app fullscreen view and keeps reset as a separate action", () => {
    render(<ChatWorkspaceMindmap source={source} />);

    const reset = screen.getByRole("button", { name: "复位视图" });
    const fullscreen = screen.getByRole("button", { name: "全屏展示" });
    expect(reset).not.toBe(fullscreen);

    fireEvent.click(screen.getByRole("button", { name: "放大" }));
    fireEvent.click(reset);
    fireEvent.click(fullscreen);

    expect(screen.getByTestId("interactive-mindmap")).toHaveClass("is-fullscreen");
    expect(screen.getByRole("button", { name: "退出全屏" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "退出全屏" }));
    expect(screen.getByTestId("interactive-mindmap")).not.toHaveClass("is-fullscreen");
  });

  it("shows a copyable fallback for invalid source", () => {
    render(<ChatWorkspaceMindmap source={"mindmap\n  root((未闭合)"} />);

    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法显示这张思维导图");
    expect(screen.getByRole("button", { name: "复制源码" })).toBeInTheDocument();
  });
});
