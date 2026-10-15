import type { ReactNode } from "react";
import "./ai-workspace-modules.css";

export function AIWorkspaceModules({ active, libraryOpen, library, children }: {
  active: boolean;
  libraryOpen: boolean;
  library: ReactNode;
  children: ReactNode;
}) {
  return <div className="ai-workspace-modules">
    <div className="ai-workspace-body">
      {/* Keep the composer and pending attachments mounted while browsing files. */}
      <div className="ai-chat-module" hidden={active && libraryOpen}>{children}</div>
      {active && libraryOpen && <section className="ai-library-module" aria-label="AI 工作区文件库">{library}</section>}
    </div>
  </div>;
}
