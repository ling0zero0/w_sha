import type { ChatMessage } from "@werewolf/shared";
import { useEffect, useId, useRef, useState } from "react";

export function chatMessageText(message: ChatMessage): string {
  if (message.content.kind === "text" || message.content.kind === "system") {
    return message.content.text;
  }
  if (message.content.kind === "target-suggestion") {
    return `建议选择 ${message.content.target.number} 号${message.content.target.nickname}`;
  }
  return message.content.code === "agree" ? "赞同" : message.content.code === "disagree" ? "反对" : "建议空刀";
}

export function ChatTimeline({ messages, emptyText, className = "" }: { messages: ChatMessage[]; emptyText: string; className?: string }) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const timelineId = useId();
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const latestMessageId = messages.at(-1)?.id;

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!latestMessageId) {
      followLatest.current = true;
      setHasNewMessages(false);
    } else if (timeline && followLatest.current) {
      timeline.scrollTop = timeline.scrollHeight;
      setHasNewMessages(false);
    } else {
      setHasNewMessages(true);
    }
  }, [latestMessageId]);

  return (
    <>
    {/* Keyboard users need a focus stop to scroll this read-only message history. */}
    <div
      id={timelineId}
      className={`chat-timeline ${className}`.trim()}
      ref={timelineRef}
      role="log"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable chat history requires keyboard scrolling.
      tabIndex={0}
      aria-label="聊天记录"
      aria-live="polite"
      aria-relevant="additions"
      onScroll={() => {
        const timeline = timelineRef.current;
        if (!timeline) return;
        followLatest.current = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= 48;
        if (followLatest.current) setHasNewMessages(false);
      }}
    >
      {messages.length === 0 ? (
        <p className="chat-empty">{emptyText}</p>
      ) : (
        messages.map((message) => (
          <article className="chat-message" key={message.id}>
            <span>{message.sender.kind === "system" ? message.sender.label : `${message.sender.number} 号 · ${message.sender.nickname}`}</span>
            <p>{chatMessageText(message)}</p>
          </article>
        ))
      )}
    </div>
    {hasNewMessages ? (
      <button
        className="chat-latest-button"
        type="button"
        aria-controls={timelineId}
        onClick={() => {
          const timeline = timelineRef.current;
          if (timeline) timeline.scrollTop = timeline.scrollHeight;
          followLatest.current = true;
          setHasNewMessages(false);
          timeline?.focus({ preventScroll: true });
        }}
      >
        有新消息 · 跳到最新
      </button>
    ) : null}
    </>
  );
}
