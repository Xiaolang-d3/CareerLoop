import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

function ThinkingMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.05 12.7A5.55 5.55 0 1 1 11.85 5.7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M12.55 7.05a5.55 5.55 0 0 1 .05 2.2"
        stroke="#6557dc"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M12.4 9.85A5.55 5.55 0 0 1 10.7 12.7"
        stroke="#8B9BFF"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

type Props = {
  streaming: boolean;
  title: string;
  currentTask?: string;
  thoughts: string[];
};

export function AnalysisThinkingProcess({
  streaming,
  title,
  currentTask,
  thoughts
}: Props) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  useEffect(() => {
    if (streaming) setUserOpen(null);
  }, [streaming]);
  const expanded = userOpen ?? streaming;
  const hasBody = thoughts.length > 0;
  if (!hasBody && !streaming) return null;
  return (
    <div className="resume-analysis-thinking">
      <section
        className={`thinking-process ${expanded ? "expanded" : ""} ${streaming ? "streaming" : "complete"}`}
        aria-label="思考过程"
      >
        <button
          type="button"
          className="thinking-process-header"
          aria-expanded={expanded}
          onClick={() => setUserOpen((current) => !(current ?? streaming))}
        >
          <span className="thinking-process-icon"><ThinkingMark /></span>
          <span className="thinking-process-copy">
            <strong><span className="thinking-process-title">{title}</span></strong>
            {currentTask ? <small className="thinking-process-current" title={currentTask}>{currentTask}</small> : null}
          </span>
          <ChevronDown className="thinking-process-chevron" size={14} />
        </button>
        {hasBody ? (
          <div className="thinking-process-collapse">
            <div className="thinking-process-scroll">
              <ol className="thinking-steps">
                {thoughts.map((thought, index) => (
                  <li
                    key={`${index}-${thought}`}
                    className={`thinking-step ${index === thoughts.length - 1 && streaming ? "is-running" : "is-done"}`}
                  >
                    <span className="thinking-step-marker" aria-hidden="true" />
                    <p>{thought}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
