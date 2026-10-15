import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { createApiClient } from "../../api/client";
import { useLibrary } from "./useLibrary";

afterEach(cleanup);

function setup() {
  const fetchJson = vi.fn(async (path: string, _init?: RequestInit) => {
    if (path === "/library") return { profile: null, facts: [], sources: [], collections: [], folders: [] };
    if (path === "/library/sources/import") return { results: [{ ok: true, filename: "test.txt", source: { id: 7 } }] };
    return { source: { id: 7 } };
  });
  const hook = renderHook(() => useLibrary({
    fetchJson: fetchJson as unknown as ReturnType<typeof createApiClient>, apiBase: "/api", accessToken: "test-token",
    setErrorMessage: vi.fn(), setNoticeMessage: vi.fn()
  }));
  return { fetchJson, ...hook };
}

it("archives uploads by default and associates new files with the selected topic", async () => {
  const { result, fetchJson } = setup();
  await act(() => result.current.importLibraryFiles([new File(["资料"], "test.txt")], null, 10));
  const request = fetchJson.mock.calls.find(([path]) => path === "/library/sources/import")!;
  const form = (request[1] as RequestInit).body as FormData;
  expect(form.get("enabled")).toBe("false");
  expect(form.get("privacy_mode")).toBe("redacted");
  expect(fetchJson).toHaveBeenCalledWith("/library/collections/10/sources", expect.objectContaining({ body: JSON.stringify({ source_ids: [7], action: "add" }) }));
});

it("archives new notes without automatically granting long-term use", async () => {
  const { result, fetchJson } = setup();
  await act(() => result.current.createPastedSource("笔记", "资料正文", "redacted", null, 10));
  expect(fetchJson).toHaveBeenCalledWith("/library/sources", expect.objectContaining({ body: JSON.stringify({ title: "笔记", content: "资料正文", privacy_mode: "redacted", enabled: false }) }));
  expect(fetchJson).toHaveBeenCalledWith("/library/collections/10/sources", expect.objectContaining({ body: JSON.stringify({ source_ids: [7], action: "add" }) }));
});

it("creates a collection with file references in one request", async () => {
  const { result, fetchJson } = setup();
  await act(() => result.current.createLibraryCollection("阅读", [7]));
  expect(fetchJson).toHaveBeenCalledWith("/library/collections", expect.objectContaining({ body: JSON.stringify({ name: "阅读", source_ids: [7] }) }));
  expect(fetchJson.mock.calls.map(([path]) => path)).toEqual(["/library/collections", "/library"]);
});
