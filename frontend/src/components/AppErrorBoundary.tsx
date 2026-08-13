import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[CareerLoop] application render failed", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-error-boundary" role="alert">
          <section>
            <h1>页面暂时无法显示</h1>
            <p>刷新页面后重试；如果问题持续，请把下面的错误信息发给开发者。</p>
            <code>{this.state.error.message || "未知页面错误"}</code>
            <button type="button" onClick={() => window.location.reload()}>刷新页面</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
