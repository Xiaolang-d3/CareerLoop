import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"]
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@assistant-ui")) return "assistant-ui";
          if (id.includes("@ant-design/x-markdown")) return "x-markdown";
          if (
            id.includes("react-markdown")
            || id.includes("remark-gfm")
            || id.includes("micromark")
            || id.includes("mdast")
          ) {
            return "markdown";
          }
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5173,
    host: "127.0.0.1"
  }
});
