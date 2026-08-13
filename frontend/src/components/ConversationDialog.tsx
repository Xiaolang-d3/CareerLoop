import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { Conversation } from "../types";
import { ActionButton } from "./ui";

export type ConversationDialogState =
  | { kind: "rename"; conversation: Conversation }
  | { kind: "delete"; conversation: Conversation };

type ConversationDialogProps = {
  dialog: ConversationDialogState;
  busy?: boolean;
  onClose: () => void;
  onRename: (conversation: Conversation, title: string) => void;
  onDelete: (conversation: Conversation) => void;
};

export function ConversationDialog({ dialog, busy = false, onClose, onRename, onDelete }: ConversationDialogProps) {
  const [title, setTitle] = useState(dialog.conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const isRename = dialog.kind === "rename";

  useEffect(() => {
    setTitle(dialog.conversation.title);
    if (isRename) window.setTimeout(() => inputRef.current?.select(), 0);
  }, [dialog, isRename]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const cleanTitle = title.trim();
  const canRename = Boolean(cleanTitle) && cleanTitle !== dialog.conversation.title && !busy;

  return (
    <div className="action-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className={`action-dialog ${isRename ? "is-rename" : "is-delete"}`} role="dialog" aria-modal="true" aria-labelledby="conversation-dialog-title">
        <div className="action-dialog-heading">
          <div>
            <h2 id="conversation-dialog-title">{isRename ? "重命名对话" : "删除对话"}</h2>
            <p>{isRename ? "用一个容易识别的名称保存这段准备。" : `删除“${dialog.conversation.title}”后无法恢复。`}</p>
          </div>
          <button className="action-dialog-close" type="button" aria-label="关闭" onClick={onClose} disabled={busy}><X size={16} /></button>
        </div>

        {isRename ? (
          <label className="action-dialog-field">
            <span>对话名称</span>
            <input
              ref={inputRef}
              value={title}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canRename) onRename(dialog.conversation, cleanTitle);
              }}
            />
          </label>
        ) : null}

        <div className="action-dialog-actions">
          <ActionButton variant="ghost" onClick={onClose} disabled={busy}>取消</ActionButton>
          {isRename ? (
            <ActionButton variant="primary" onClick={() => onRename(dialog.conversation, cleanTitle)} disabled={!canRename}>保存</ActionButton>
          ) : (
            <ActionButton variant="danger" icon={<Trash2 size={15} />} onClick={() => onDelete(dialog.conversation)} disabled={busy}>删除</ActionButton>
          )}
        </div>
      </section>
    </div>
  );
}
