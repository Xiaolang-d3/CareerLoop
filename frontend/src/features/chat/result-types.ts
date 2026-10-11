import { createContext } from "react";
import type { LibraryFolder, LibrarySourceDetail } from "../../types";

export type ChatArtifact = {
  selector: string;
  kind: "answer" | "code" | "diagram" | "attachment";
  filename: string;
  mime_type: string;
  content?: string;
  attachment_id?: string;
  can_index: boolean;
};
export type ArtifactManifest = { message_id: number; snapshot: string; incomplete: boolean; artifacts: ChatArtifact[]; folders?: LibraryFolder[] };
export type SaveResultRequest = { selector: string; snapshot: string; filename: string; folder_id: number | null; enabled: boolean };
export type ResultServices = {
  onLoadResults?: (messageId: number, signal?: AbortSignal) => Promise<ArtifactManifest>;
  onSaveResult?: (messageId: number, request: SaveResultRequest, signal?: AbortSignal) => Promise<{ source: LibrarySourceDetail; reused: boolean }>;
  onOpenSavedResult?: (sourceId: number) => void;
  resultFolders?: LibraryFolder[];
};
export const ResultActionsContext = createContext<((messageId: number, selector?: string, saving?: boolean) => void) | null>(null);
