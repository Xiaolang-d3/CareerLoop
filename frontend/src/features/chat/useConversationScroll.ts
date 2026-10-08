import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "./types";

/** Follow output only while the reader stays near the bottom. */
export function useConversationScroll(conversationId: number | null, messages: ChatMessage[], suspended = false) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previous = useRef({ conversationId, firstId: messages[0]?.id, count: 0, height: 0, signature: "" });
  const [away, setAway] = useState(false);
  const [unread, setUnread] = useState(false);
  const signature = JSON.stringify(messages.map((message) => [message.id, message.content]));
  const jumpToLatest = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    following.current = true;
    viewport.scrollTop = viewport.scrollHeight;
    setAway(false);
    setUnread(false);
  }, []);
  const onScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 64;
    following.current = atBottom;
    setAway(!atBottom);
    if (atBottom) setUnread(false);
  }, []);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const old = previous.current;
    if (old.conversationId !== conversationId || old.count === 0) jumpToLatest();
    else if (messages[0]?.id !== old.firstId && messages.some((message) => message.id === old.firstId)) {
      // Loading older history should keep the same visible text in place.
      viewport.scrollTop += viewport.scrollHeight - old.height;
    } else if (following.current && !suspended) jumpToLatest();
    else if (signature !== old.signature) setUnread(true);
    previous.current = { conversationId, firstId: messages[0]?.id, count: messages.length, height: viewport.scrollHeight, signature };
  }, [conversationId, messages, signature, jumpToLatest, suspended]);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (following.current && !suspended) jumpToLatest();
      if (viewportRef.current) previous.current.height = viewportRef.current.scrollHeight;
    });
    observer.observe(content);
    if (viewportRef.current) observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [jumpToLatest, suspended]);
  const restorePosition = useCallback((top: number) => {
    if (viewportRef.current) viewportRef.current.scrollTop = top;
    onScroll();
  }, [onScroll]);
  return { viewportRef, contentRef, away, unread, onScroll, jumpToLatest, restorePosition };
}
