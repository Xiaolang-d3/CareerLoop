import { useState } from "react";
import { createApiClient, fetchWithTimeout } from "../../api/client";
import { emptyLibraryEditor } from "../../constants";
import type { LibraryBundle, LibrarySource, LibrarySourceDetail } from "../../types";

type Options = { fetchJson: ReturnType<typeof createApiClient>; apiBase: string; accessToken: string; setErrorMessage: (message: string) => void; setNoticeMessage: (message: string) => void };

export function useLibrary({ fetchJson, apiBase, accessToken, setErrorMessage, setNoticeMessage }: Options) {
  const [libraryEditor, setLibraryEditor] = useState(emptyLibraryEditor);

  const [librarySources, setLibrarySources] = useState<LibrarySource[]>([]);

  const [confirmedKnowledgeCount, setConfirmedKnowledgeCount] = useState(0);

  const [sourceCount, setSourceCount] = useState(0);

  const [pendingKnowledge, setPendingKnowledge] = useState<Array<{
    id: number;
    statement: string;
    category?: string;
    value?: { name?: string };
    sourceKind?: string;
    evidence?: Array<{ excerpt?: string; source_title?: string }>;
  }>>([]);

  const [libraryLoaded, setLibraryLoaded] = useState(false);

  const [libraryBusy, setLibraryBusy] = useState(false);

  const [sourceImportBusy, setSourceImportBusy] = useState(false);

  const [enhancedDocumentParse, setEnhancedDocumentParse] = useState(false);

  async function refreshLibrary() {
    try {
      const bundle = await fetchJson<LibraryBundle>("/library");
      const confirmedFacts = bundle.facts.filter((fact) => fact.status === "confirmed");
      const pendingFacts = bundle.facts.filter((fact) => fact.status === "pending");
      setConfirmedKnowledgeCount(confirmedFacts.length);
      setSourceCount(bundle.sources.length);
      setLibrarySources(bundle.sources);
      setPendingKnowledge(pendingFacts.map((fact) => ({
        id: fact.id,
        statement: fact.statement,
        category: fact.category,
        value: fact.value as { name?: string } | undefined,
        sourceKind: fact.source_kind,
        evidence: fact.evidence
      })));
      setLibraryEditor((current) => ({
        ...current,
        name: bundle.profile?.name || "",
        privacyMode: bundle.profile?.privacy_mode || "redacted"
      }));
    } finally {
      setLibraryLoaded(true);
    }
  }

  async function saveLibraryMetadata(): Promise<boolean> {
    setLibraryBusy(true);
    setErrorMessage("");
    try {
      await fetchJson("/library", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: libraryEditor.name.trim(),
          locale: "zh-CN",
          privacy_mode: libraryEditor.privacyMode
        })
      });
      await Promise.all([refreshLibrary()]);
      setNoticeMessage("个性化信息已保存");
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存资料库失败");
      return false;
    } finally {
      setLibraryBusy(false);
    }
  }

  async function importLibraryFiles(files: File[]) {
    if (!files.length) return;
    setSourceImportBusy(true);
    setErrorMessage("");
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      form.append("mode", enhancedDocumentParse ? "enhanced" : "fast");
      form.append("privacy_mode", "redacted");
      const response = await fetchJson<{ results: Array<{ filename: string; ok: boolean; error?: string }> }>("/library/sources/import", {
        method: "POST",
        body: form
      });
      const failures = response.results.filter((item) => !item.ok);
      await Promise.all([refreshLibrary()]);
      if (failures.length) {
        setErrorMessage(`${response.results.length - failures.length} 个文件已导入，${failures.length} 个失败：${failures.map((item) => item.filename).join("、")}`);
      } else {
        setNoticeMessage(`${response.results.length} 个来源已独立导入`);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "资料解析失败");
    } finally {
      setSourceImportBusy(false);
    }
  }

  async function createPastedSource(title: string, content: string, privacyMode: "redacted" | "original") {
    await fetchJson("/library/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, privacy_mode: privacyMode })
    });
    await Promise.all([refreshLibrary()]);
    setNoticeMessage("文本来源已创建");
  }

  async function updateLibrarySource(sourceId: number, changes: Partial<Pick<LibrarySource, "title" | "privacy_mode" | "enabled">> & { content?: string }) {
    await fetchJson(`/library/sources/${sourceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes)
    });
    await refreshLibrary();
  }

  async function downloadLibrarySource(source: LibrarySourceDetail) {
    const response = await fetchWithTimeout(`${apiBase}/library/sources/${source.id}/file`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error("原文件下载失败，请重试");
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = source.original_filename || source.title;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }

  async function deleteLibrarySource(sourceId: number) {
    await fetchJson(`/library/sources/${sourceId}`, { method: "DELETE" });
    await Promise.all([refreshLibrary()]);
    setNoticeMessage("来源及本地原文件已删除");
  }

  return { libraryEditor, librarySources, confirmedKnowledgeCount, sourceCount, pendingKnowledge, libraryLoaded, libraryBusy, sourceImportBusy, enhancedDocumentParse, setLibraryEditor, setEnhancedDocumentParse, refreshLibrary, saveLibraryMetadata, importLibraryFiles, createPastedSource, updateLibrarySource, downloadLibrarySource, deleteLibrarySource };
}
