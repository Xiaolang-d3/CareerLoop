import { useState } from "react";
import { FileText, Sparkles } from "lucide-react";
import type { LibraryBundle, LibrarySource } from "../../types";
import { homeInboxItems, type HomePendingFact } from "../home/home-metrics";
import { knowledgeUse } from "./library-state";

export function LibraryKnowledgePanel({ sources, pendingFacts, confirmedFacts, working, reviewAvailable, onReview, onShowSources }: {
  sources: LibrarySource[];
  pendingFacts: HomePendingFact[];
  confirmedFacts: LibraryBundle["facts"];
  working: boolean;
  reviewAvailable: boolean;
  onReview: (id: number, action: "confirm" | "reject") => Promise<boolean>;
  onShowSources: () => void;
}) {
  const [reviewed, setReviewed] = useState<number[]>([]);
  const pending = homeInboxItems(pendingFacts).filter((item) => !reviewed.includes(item.id));
  const confirmed = confirmedFacts.filter((fact) => fact.status === "confirmed");
  const readyCount = sources.filter((source) => !source.trashed_at && knowledgeUse(source) === "ready").length;
  return <section className="fl-knowledge" aria-label="知识管理">
    <header>
      <div><h1>让资料成为可复用的知识</h1><p>长期使用的资料和你确认的知识分别管理。</p></div>
      <button type="button" className="fl-button" onClick={onShowSources}><FileText size={17} />查看长期资料</button>
    </header>
    <div className="fl-knowledge-summary" aria-label="知识概览">
      <div><strong>{readyCount}</strong><span>份长期资料</span><small>你已开启长期使用的可读文件</small></div>
      <div><strong>{pending.length}</strong><span>条待确认知识</span><small>你的确认决定是否保存</small></div>
      <div><strong>{confirmed.length}</strong><span>条已确认知识</span><small>可在后续问答与创作中复用</small></div>
    </div>
    <p className="fl-knowledge-hint"><Sparkles size={17} />主题集合只整理文件。长期资料遵循记忆设置；AI 提取的结论仍需你确认。</p>
    <section className="fl-knowledge-section" aria-label="待确认内容">
      <h3>待确认知识 <small>{pending.length}</small></h3>
      {pending.length ? <ul>{pending.map((item) => <li key={item.id}>
        <strong>{item.title}</strong><p>{item.consequence}</p>
        <small>来源：{item.sourceLabel}</small>
        {item.source && <blockquote>{item.source}</blockquote>}
        <div className="fl-knowledge-actions">{(["confirm", "reject"] as const).map((action) =>
          <button key={action} type="button" className={`fl-button ${action === "confirm" ? "primary" : ""}`}
            disabled={working || !reviewAvailable} onClick={() => void (async () => {
              if (await onReview(item.id, action)) setReviewed((current) => [...current, item.id]);
            })()}>{action === "confirm" ? "确认" : "不是"}</button>
        )}</div>
      </li>)}</ul> : <p className="fl-knowledge-empty">暂无待确认知识。对话中提出的知识会先出现在这里，确认后再保存。</p>}
    </section>
    <section className="fl-knowledge-section" aria-label="已确认知识">
      <h3>已确认知识 <small>{confirmed.length}</small></h3>
      {confirmed.length ? <ul>{confirmed.map((fact) => <li key={fact.id}>
        <strong>{fact.statement}</strong>
        {fact.evidence?.[0]?.source_title && <small>来源：{fact.evidence[0].source_title}</small>}
      </li>)}</ul> : <p className="fl-knowledge-empty">还没有已确认知识。开启文件的长期使用，不会自动确认其中的结论。</p>}
    </section>
  </section>;
}
