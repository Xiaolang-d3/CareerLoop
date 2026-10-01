import React from "react";
import { createRoot } from "react-dom/client";
import { Bootstrap } from "./app/Bootstrap";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

const root = createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      <Bootstrap />
    </AppErrorBoundary>
  </React.StrictMode>
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => root.unmount());
}
