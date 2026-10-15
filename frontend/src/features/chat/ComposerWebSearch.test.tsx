import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentCapabilities } from "../../types";
import type { WebSearchOptions } from "./types";
import { ComposerWebSearch } from "./ComposerWebSearch";

afterEach(cleanup);
const tavily: AgentCapabilities["web_research"] = { enabled: true, provider: "tavily", supported_topics: ["auto", "general", "news", "finance"], supports_auto_parameters: true, supports_technical_preference: true };
function setup(capabilities: AgentCapabilities["web_research"] = tavily, busy = false) {
  const onChange = vi.fn();
  const onRefresh = vi.fn();
  function Harness() {
    const [options, setOptions] = useState<WebSearchOptions>({ version: 1, enabled: true, topic: "auto", source_preference: "none" });
    return <ComposerWebSearch available capabilities={capabilities} options={options} provider={capabilities?.provider} busy={busy} onRefresh={onRefresh} onChange={(next) => { onChange(next); setOptions(next); }} />;
  }
  render(<Harness />);
  return { onChange, onRefresh };
}
describe("ComposerWebSearch", () => {
  it("preserves category and preference when search is disabled and enabled again", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "搜索类别" }));
    fireEvent.click(screen.getByRole("radio", { name: /金融/ }));
    fireEvent.click(screen.getByRole("button", { name: "搜索类别" }));
    fireEvent.click(screen.getByRole("button", { name: "搜索设置" }));
    fireEvent.click(screen.getByRole("radio", { name: /优先技术资料/ }));
    fireEvent.click(screen.getByRole("button", { name: "联网搜索" }));
    expect(screen.queryByRole("button", { name: "搜索类别" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "联网搜索" }));
    expect(screen.getByRole("button", { name: "搜索类别" })).toHaveTextContent("金融");
    expect(onChange).toHaveBeenLastCalledWith({ version: 1, enabled: true, topic: "finance", source_preference: "technical" });
  });
  it("clearly disables finance and technical preference for AgentSearch", () => {
    setup({ ...tavily, provider: "agent_search", supported_topics: ["auto", "general", "news"], supports_auto_parameters: false, supports_technical_preference: false });
    fireEvent.click(screen.getByRole("button", { name: "搜索类别" }));
    expect(screen.getByRole("radio", { name: /金融/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /金融/ })).toHaveTextContent("AgentSearch 暂不支持");
    fireEvent.click(screen.getByRole("button", { name: "搜索设置" }));
    expect(screen.getByRole("radio", { name: /优先技术资料/ })).toBeDisabled();
  });
  it("explains that mixed local-and-web tasks confirm each query before sending", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "搜索类别" }));
    expect(screen.getByText(/发送每条查询前先向你确认/)).toBeInTheDocument();
  });
  it("locks all controls while a run is active", () => {
    setup(tavily, true);
    expect(screen.getByRole("button", { name: "联网搜索" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "搜索类别" })).toBeDisabled();
  });
  it("offers a capability retry instead of claiming unknown categories work", () => {
    const { onRefresh } = setup({ enabled: true, provider: "tavily" });
    fireEvent.click(screen.getByRole("button", { name: "搜索类别" }));
    expect(screen.getByRole("radio", { name: /通用/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
  it("supports arrow navigation and Escape restores focus to the trigger", () => {
    setup();
    const trigger = screen.getByRole("button", { name: "搜索类别" });
    fireEvent.click(trigger);
    const auto = screen.getByRole("radio", { name: /自动/ });
    expect(auto).toHaveFocus();
    fireEvent.keyDown(auto, { key: "ArrowDown" });
    expect(screen.getByRole("radio", { name: /通用/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("radio", { name: /通用/ }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "联网搜索设置" })).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
