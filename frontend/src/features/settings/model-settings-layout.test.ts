// The application tsconfig is browser-only, while Vitest provides these Node APIs at runtime.
// @ts-expect-error Node types are intentionally not part of the production frontend.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally not part of the production frontend.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workingDirectory = (globalThis as typeof globalThis & { process: { cwd(): string } }).process.cwd();
const pageStyles = readFileSync(resolve(workingDirectory, "src/features/settings/model-settings.css"), "utf8");
const legacyStyles = readFileSync(resolve(workingDirectory, "src/styles.css"), "utf8");
const workspaceStyles = readFileSync(resolve(workingDirectory, "src/features/settings/settings-workspace.css"), "utf8");

describe("model settings layout regression", () => {
  it("does not restore the oversized desktop layout or overlapping monitor column", () => {
    expect(legacyStyles).not.toMatch(
      /\.model-settings-page\s*\{[^}]*grid-template-columns:\s*minmax\(320px,\s*\.78fr\)\s+minmax\(520px/
    );
    expect(pageStyles).not.toMatch(/\.model-monitor-card\s*\{[^}]*grid-column:\s*3/);
    expect(pageStyles).not.toContain("max-width: 1360px");
    expect(workspaceStyles).not.toContain("min(1360px, 100%)");
  });
});
