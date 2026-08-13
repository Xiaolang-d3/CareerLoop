import { afterEach, describe, expect, it, vi } from "vitest";
import { createClientId } from "./clientId";

describe("createClientId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses randomUUID when the browser supports it", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "native-id" });

    expect(createClientId()).toBe("native-id");
  });

  it("falls back to a UUID when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(0) });

    expect(createClientId()).toBe("00000000-0000-4000-8000-000000000000");
  });
});
