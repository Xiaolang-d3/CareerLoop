import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "./features/appearance/ThemeProvider";
import { Bootstrap } from "./app/Bootstrap";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

const root = createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ThemeProvider><Bootstrap /></ThemeProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => root.unmount());
}
