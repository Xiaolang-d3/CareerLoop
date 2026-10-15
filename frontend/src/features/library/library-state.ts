import type { LibrarySource } from "../../types";

export type LibraryCategory = "all" | "recent" | "favorites" | "trash";
export type KnowledgeUse = "all" | "ready" | "archive" | "needs_text";
export type SourceOrigin = "all" | "upload" | "note" | "chat";
export type FileFilters = { origin: SourceOrigin; knowledge: KnowledgeUse };
export const emptyFileFilters: FileFilters = { origin: "all", knowledge: "all" };

export function hasReadableText(source: LibrarySource | undefined) {
  return Boolean(source && source.parse_status === "ready" && source.character_count > 0);
}

export function knowledgeUse(source: LibrarySource): Exclude<KnowledgeUse, "all"> {
  if (!hasReadableText(source)) return "needs_text";
  return source.enabled ? "ready" : "archive";
}

export function knowledgeLabel(source: LibrarySource) {
  if (source.trashed_at) return "已移出知识检索";
  const state = knowledgeUse(source);
  return state === "ready" ? "长期使用" : state === "archive" ? "仅存档" : "无可检索正文";
}

export function sourceOrigin(source: LibrarySource): Exclude<SourceOrigin, "all"> {
  if (source.source_uri.startsWith("chat:")) return "chat";
  return source.source_kind === "paste" ? "note" : "upload";
}

export function visibleLibrarySources(sources: LibrarySource[], options: {
  category: LibraryCategory;
  folderId: number | null;
  unfiled: boolean;
  filters: FileFilters;
  query: string;
  searchIds: number[] | null;
  ascending: boolean;
  collectionSourceIds?: number[];
}) {
  const { category, folderId, unfiled, filters, searchIds, ascending } = options;
  const query = options.query.trim().toLocaleLowerCase();
  const matched = searchIds === null ? null : new Set(searchIds);
  const collectionMembers = options.collectionSourceIds ? new Set(options.collectionSourceIds) : null;
  return sources.filter((source) =>
    (category === "trash" ? Boolean(source.trashed_at) : !source.trashed_at) &&
    (category !== "favorites" || source.favorite) &&
    (category !== "recent" || source.last_opened_at) &&
    (folderId === null || source.folder_id === folderId) &&
    (!unfiled || source.folder_id == null) &&
    (collectionMembers === null || collectionMembers.has(source.id)) &&
    (filters.origin === "all" || sourceOrigin(source) === filters.origin) &&
    (filters.knowledge === "all" || knowledgeUse(source) === filters.knowledge) &&
    (!query || (matched ? matched.has(source.id) :
      `${source.title} ${source.original_filename}`.toLocaleLowerCase().includes(query)))
  ).sort((a, b) => (ascending ? 1 : -1) *
    ((category === "recent" ? (a.last_opened_at || "").localeCompare(b.last_opened_at || "") :
      a.updated_at.localeCompare(b.updated_at)) || a.id - b.id));
}
