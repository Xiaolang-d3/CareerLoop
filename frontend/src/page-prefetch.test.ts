import { describe, expect, it, vi } from "vitest";
import { createPagePrefetcher } from "./page-prefetch";

describe("createPagePrefetcher", () => {
  it("loads a requested page only once even when hover and idle prefetch overlap", async () => {
    const chat = vi.fn(async () => undefined);
    const prefetcher = createPagePrefetcher({ chat });

    await Promise.all([prefetcher.prefetch("chat"), prefetcher.prefetch("chat")]);

    expect(chat).toHaveBeenCalledOnce();
  });

  it("schedules low-priority pages without blocking the current page", () => {
    const projects = vi.fn(async () => undefined);
    const schedule = vi.fn((callback: () => void) => callback());
    const prefetcher = createPagePrefetcher({ projects });

    prefetcher.prefetchWhenIdle(["projects"], schedule);

    expect(schedule).toHaveBeenCalledOnce();
    expect(projects).toHaveBeenCalledOnce();
  });
});
