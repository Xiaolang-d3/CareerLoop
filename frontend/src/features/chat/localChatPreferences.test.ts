import { describe, expect, it, vi } from "vitest";
import { readConversationFolders, writeConversationFolders } from "./localChatPreferences";

describe("conversation folder preferences", () => {
  it("keeps only named folders and assignments that point at them", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); }
    });
    writeConversationFolders("folders", [{ id: "project", name: "项目" }], { 4: "project", 5: "missing" });
    storage.set("broken", "{");
    expect(readConversationFolders("folders")).toEqual({ folders: [{ id: "project", name: "项目" }], assignments: { 4: "project" } });
    expect(readConversationFolders("broken")).toEqual({ folders: [], assignments: {} });
    vi.unstubAllGlobals();
  });
});
