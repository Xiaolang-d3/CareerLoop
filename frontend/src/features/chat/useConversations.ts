import { useState } from "react";
import { createApiClient } from "../../api/client";
import type { ConversationDialogState } from "../../components/ConversationDialog";
import type { Conversation, ViewKey } from "../../types";

type Options = { fetchJson: ReturnType<typeof createApiClient>; setActiveView: (view: ViewKey) => void; setErrorMessage: (message: string) => void; setNoticeMessage: (message: string) => void };
export function useConversations({ fetchJson, setActiveView, setErrorMessage, setNoticeMessage }: Options) {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);

  const [conversationBusy, setConversationBusy] = useState(false);

  const [conversationDialog, setConversationDialog] = useState<ConversationDialogState | null>(null);

  async function refreshConversations() {
    const next = await fetchJson<Conversation[]>("/conversations");
    setConversations(next);
    return next;
  }

  async function createNewConversation() {
    if (conversationBusy) return;
    setConversationBusy(true);
    try {
      const created = await fetchJson<Conversation>("/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "新对话" })
      });
      await refreshConversations();
      setCurrentConversationId(created.id);
      setActiveView("chat");
      setNoticeMessage("已新建对话");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "新建对话失败");
    } finally {
      setConversationBusy(false);
    }
  }

  async function archiveConversation(conversation: Conversation) {
    setConversationBusy(true);
    try {
      await fetchJson(`/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: conversation.status === "active" ? "archived" : "active" })
      });
      const next = await refreshConversations();
      if (conversation.id === currentConversationId && conversation.status === "active") {
        setCurrentConversationId(next.find((item) => item.status === "active")?.id ?? next[0]?.id ?? null);
      }
      setNoticeMessage(conversation.status === "active" ? "已归档" : "已恢复");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "归档对话失败");
    } finally {
      setConversationBusy(false);
    }
  }

  async function renameConversation(conversation: Conversation, title: string) {
    try {
      setConversationBusy(true);
      await fetchJson(`/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      await refreshConversations();
      setConversationDialog(null);
      setNoticeMessage("已重命名");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "重命名失败");
    } finally {
      setConversationBusy(false);
    }
  }

  async function removeConversation(conversation: Conversation) {
    setConversationBusy(true);
    try {
      const result = await fetchJson<{ next_conversation: Conversation }>(`/conversations/${conversation.id}`, { method: "DELETE" });
      const next = await refreshConversations();
      if (conversation.id === currentConversationId) {
        setCurrentConversationId(result.next_conversation?.id ?? next[0]?.id ?? null);
      }
      setConversationDialog(null);
      setNoticeMessage("已删除");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除对话失败");
    } finally {
      setConversationBusy(false);
    }
  }
  return { conversations, setConversations, currentConversationId, setCurrentConversationId, conversationBusy, setConversationBusy, conversationDialog, setConversationDialog, refreshConversations, createNewConversation, archiveConversation, renameConversation, removeConversation };
}
