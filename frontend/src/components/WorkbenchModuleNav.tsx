export type WorkbenchModule = "analysis" | "resume" | "interview";

export function WorkbenchModuleNav({
  active,
  onSelectAnalysis,
  onSelectResume,
  onSelectInterview
}: {
  active: WorkbenchModule;
  onSelectAnalysis: () => void;
  onSelectResume: () => void;
  onSelectInterview: () => void;
}) {
  const tabs: Array<{ id: WorkbenchModule; label: string; onSelect: () => void }> = [
    { id: "analysis", label: "匹配分析", onSelect: onSelectAnalysis },
    { id: "resume", label: "定制简历", onSelect: onSelectResume },
    { id: "interview", label: "面试问答", onSelect: onSelectInterview }
  ];
  return (
    <nav className="workbench-module-nav" aria-label="求职模块">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          className={active === tab.id ? "active" : ""}
          aria-current={active === tab.id ? "page" : undefined}
          onClick={tab.onSelect}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
