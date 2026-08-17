import { describe, expect, it, vi } from "vitest";
import { createRouteDataCache, requiredDataForRoute } from "./route-data";

describe("requiredDataForRoute", () => {
  it("loads and shares the preparation data for its three sub-pages", () => {
    expect(requiredDataForRoute({ section: "interview-prep", page: "projects" })).toEqual(["interviewPreparation"]);
    expect(requiredDataForRoute({ section: "interview-prep", page: "knowledge" })).toEqual(["interviewPreparation"]);
  });

  it("loads only the data needed when a route is opened", () => {
    expect(requiredDataForRoute({ section: "chat" })).toEqual([
      "conversations",
      "capabilities",
      "attachmentConfig"
    ]);
    expect(requiredDataForRoute({ section: "settings", page: "overview" })).toEqual([
      "candidateProfile",
      "agentSettings"
    ]);
    expect(requiredDataForRoute({ section: "settings", page: "model" })).toEqual([
      "agentSettings",
      "modelMonitor",
      "modelCapabilities"
    ]);
    expect(requiredDataForRoute({ section: "settings", page: "agent" })).toEqual([
      "agentOperations"
    ]);
    expect(requiredDataForRoute({ section: "dashboard" })).toEqual(["candidateProfile"]);
    expect(requiredDataForRoute({ section: "project-lab" })).toEqual([]);
    expect(requiredDataForRoute({ section: "workbench", page: "index" })).toEqual([
      "jobs",
      "candidateProfile",
      "workflow"
    ]);
  });
});

describe("createRouteDataCache", () => {
  it("reuses a fresh route snapshot and reloads it after its short cache window", async () => {
    let time = 1_000;
    const loader = vi.fn(async () => undefined);
    const cache = createRouteDataCache<string>(30_000, () => time);

    await cache.load("conversations", loader);
    await cache.load("conversations", loader);
    expect(loader).toHaveBeenCalledOnce();

    time += 30_001;
    await cache.load("conversations", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("reloads immediately after invalidate even inside the cache window", async () => {
    let time = 1_000;
    const loader = vi.fn(async () => undefined);
    const cache = createRouteDataCache<string>(30_000, () => time);

    await cache.load("candidateProfile", loader);
    cache.invalidate("candidateProfile");
    await cache.load("candidateProfile", loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("shares an in-flight request started by a Strict Mode remount", async () => {
    let resolveRequest: (() => void) | undefined;
    const loader = vi.fn(() => new Promise<void>((resolve) => { resolveRequest = resolve; }));
    const cache = createRouteDataCache<string>(30_000);

    const first = cache.load("capabilities", loader);
    const second = cache.load("capabilities", loader);
    resolveRequest?.();
    await Promise.all([first, second]);

    expect(loader).toHaveBeenCalledOnce();
  });
});
