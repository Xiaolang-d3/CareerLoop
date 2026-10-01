export const HOME_INBOX_LIMIT = 3;

export type HomePendingFact = {
  id: number;
  statement: string;
  category?: string;
  value?: { name?: string };
  sourceKind?: string;
  evidence?: Array<{ excerpt?: string; source_title?: string }>;
};

export type HomeInboxItem = {
  id: number;
  title: string;
  consequence: string;
  source: string;
  sourceLabel: string;
};

export function inboxFactLabel(fact: Pick<HomePendingFact, "statement" | "value">) {
  return fact.statement.trim();
}

export function homeInboxItems(facts: HomePendingFact[]): HomeInboxItem[] {
  return facts.filter((fact) => fact.statement.trim()).map((fact) => ({
    id: fact.id,
    title: inboxFactLabel(fact),
    consequence: "确认后会写入已确认知识，用于问答与创作",
    source: fact.evidence?.[0]?.excerpt?.trim() || "",
    sourceLabel: fact.evidence?.[0]?.source_title?.trim() || "对话提议"
  }));
}

export function isLibraryReady(name: string, enabledSourceCount: number) {
  return Boolean(name.trim() && enabledSourceCount > 0);
}
