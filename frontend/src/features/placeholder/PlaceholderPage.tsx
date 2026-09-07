import { Construction } from "lucide-react";
import { placeholderPageMeta } from "../../constants";
import type { PlaceholderPage as PlaceholderPageKey } from "../../routing";

export type PlaceholderPageProps = {
  page: PlaceholderPageKey;
  onOpenChat?: () => void;
  onOpenLibrary?: () => void;
};

export function PlaceholderPage({ page, onOpenChat, onOpenLibrary }: PlaceholderPageProps) {
  const meta = placeholderPageMeta[page];
  return (
    <section className="placeholder-page" aria-labelledby="placeholder-title">
      <div className="placeholder-card">
        <span className="placeholder-icon" aria-hidden="true"><Construction size={22} /></span>
        <h2 id="placeholder-title">{meta.title}</h2>
        <p>{meta.description}</p>
        <p className="placeholder-empty">该模块尚未接入后端，当前为占位页。你可以先用知识库沉淀资料，或打开 AI 助手继续对话。</p>
        <div className="placeholder-actions">
          {onOpenLibrary ? <button type="button" className="ui-button" onClick={onOpenLibrary}>打开知识库</button> : null}
          {onOpenChat ? <button type="button" className="ui-button is-primary" onClick={onOpenChat}>去 AI 问答</button> : null}
        </div>
      </div>
    </section>
  );
}
