import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(projectDir, "dist");
const files = [
  "manifest.json",
  "background.js",
  "bridge.js",
  "boss-extractor.js",
  "visible-jobs-extractor.js",
  "content.js"
  ,"popup.html"
  ,"popup.css"
  ,"popup.js"
];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await Promise.all(
  files.map((file) => cp(path.join(projectDir, file), path.join(distDir, file)))
);

console.log(`Built BossCopilot Browser extension in ${distDir}`);
