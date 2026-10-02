export type DesktopRuntimeConfig = { apiBase?: string | null; startupError?: string | null };

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke: <T>(command: string) => Promise<T> } };
  }
}

export async function resolveApiBase(): Promise<DesktopRuntimeConfig> {
  const desktopApiBase = import.meta.env.VITE_API_BASE?.trim();
  if (desktopApiBase) return { apiBase: desktopApiBase.replace(/\/$/, "") };
  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) {
    try {
      const runtime = await invoke<DesktopRuntimeConfig>("desktop_runtime_config");
      if (runtime.startupError || !runtime.apiBase) return runtime;
      return runtime;
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      return { startupError: `桌面运行时读取失败：${detail}` };
    }
  }
  // Bundled desktop must talk through Tauri; falling back to location.origin
  // (https://tauri.localhost) looks "started" but cannot reach the sidecar.
  if (window.location.protocol.startsWith("tauri") || /tauri\.localhost$/i.test(window.location.hostname)) {
    return { startupError: "桌面运行时未注入，请重新安装或从仓库重建 灯灯.app" };
  }
  return { apiBase: import.meta.env.DEV ? "/api" : window.location.origin };
}
