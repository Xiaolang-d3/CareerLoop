import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConversationScroll } from "./useConversationScroll";
import type { ChatMessage } from "./types";
const message = (id: number, content = "内容"): ChatMessage => ({ id, content, role: "assistant", created_at: "2026-10-08T00:00:00Z" });
function Harness({ id = 1, messages }: { id?: number; messages: ChatMessage[] }) {
  const scroll = useConversationScroll(id, messages);
  return <><div data-testid="viewport" ref={scroll.viewportRef} onScroll={scroll.onScroll}><div ref={scroll.contentRef}>{messages.map((item) => <p key={item.id}>{item.content}</p>)}</div></div>{scroll.away ? <button onClick={scroll.jumpToLatest}>{scroll.unread ? "有新内容" : "回到最新"}</button> : null}</>;
}
beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("preserves reading during streaming, marks updates, then resumes following", () => {
  const view = render(<Harness messages={[message(1)]} />);
  const viewport = screen.getByTestId("viewport");
  Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 1000 });
  Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 200 });
  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);
  view.rerender(<Harness messages={[message(1, "追加输出")]} />);
  expect(viewport.scrollTop).toBe(100);
  fireEvent.click(screen.getByRole("button", { name: "有新内容" }));
  expect(viewport.scrollTop).toBe(1000);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  Object.defineProperty(viewport, "scrollHeight", { value: 1200 });
  view.rerender(<Harness messages={[message(1, "继续输出")]} />);
  expect(viewport.scrollTop).toBe(1200);
});
it("preserves position for older history and resets when switching conversations", () => {
  const view = render(<Harness messages={[message(2)]} />);
  const viewport = screen.getByTestId("viewport");
  Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 1000 });
  Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 200 });
  view.rerender(<Harness messages={[message(2)]} />);
  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);
  Object.defineProperty(viewport, "scrollHeight", { value: 1300 });
  view.rerender(<Harness messages={[message(1), message(2)]} />);
  expect(viewport.scrollTop).toBe(400);
  expect(screen.getByRole("button", { name: "回到最新" })).toBeInTheDocument();
  view.rerender(<Harness id={2} messages={[message(3)]} />);
  expect(viewport.scrollTop).toBe(1300);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
