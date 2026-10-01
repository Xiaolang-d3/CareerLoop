import { TriangleAlert } from "lucide-react";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { resolveApiBase, type DesktopRuntimeConfig } from "./app/runtime";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AuthGate } from "./components/AuthGate";
import { PageLoading } from "./components/PageLoading";

function Bootstrap() {
  const [runtime, setRuntime] = useState<DesktopRuntimeConfig | null>(null);

  useEffect(() => {
    void resolveApiBase()
      .then(setRuntime)
      .catch((error: unknown) => setRuntime({
        startupError: error instanceof Error ? error.message : "无法读取桌面运行配置"
      }));
  }, []);

  if (!runtime) return <PageLoading label="正在启动 CareerLoop…" />;
  if (runtime.startupError || !runtime.apiBase) {
    return (
      <main className="page-loading" role="alert">
        <div className="page-loading-copy">
          <TriangleAlert size={20} />
          <span>{runtime.startupError || "本地服务地址不可用，请重新启动 CareerLoop。"}</span>
        </div>
      </main>
    );
  }
  return (
    <AuthGate apiBase={runtime.apiBase}>
      {(accessToken, onLogout, user, updateSession) => (
        <App apiBase={runtime.apiBase!} accessToken={accessToken} onLogout={onLogout} user={user} updateSession={updateSession} />
      )}
    </AuthGate>
  );
}

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
