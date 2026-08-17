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

function mediaBlock(styles: string, query: string): string {
  const start = styles.indexOf(`@media ${query}`);
  if (start === -1) return "";
  const openingBrace = styles.indexOf("{", start);
  let depth = 1;
  let end = openingBrace + 1;
  while (depth > 0 && end < styles.length) {
    if (styles[end] === "{") depth += 1;
    if (styles[end] === "}") depth -= 1;
    end += 1;
  }
  return styles.slice(openingBrace + 1, end - 1);
}

describe("model settings large-screen layout", () => {
  it("does not keep the legacy two-column page that overlaps the monitor card", () => {
    expect(legacyStyles).not.toMatch(
      /\.model-settings-page\s*\{[^}]*grid-template-columns:\s*minmax\(320px,\s*\.78fr\)\s+minmax\(520px/
    );
    expect(pageStyles).toMatch(/\.model-settings-page\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it("places connection, catalog, and monitor side by side on wide desktops", () => {
    const wide = mediaBlock(pageStyles, "(min-width: 1400px)");
    expect(wide).toContain("grid-template-columns: minmax(0, .72fr) minmax(0, .78fr) minmax(0, 1.1fr)");
    expect(wide).toContain(".model-settings-top { display: contents; }");
    expect(wide).toContain("grid-column: 3");
    expect(workspaceStyles).toContain(".settings-workspace.settings-model");
    expect(workspaceStyles).toContain("min(1360px, 100%)");
  });
});
