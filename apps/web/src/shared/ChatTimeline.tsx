import type { ChatMessage } from "@werewolf/shared";
import { useEffect, useRef } from "react";

export function chatMessageText(message: ChatMessage): string {
  if (message.content.kind === "text" || message.content.kind === "system") {
    return message.content.text;
  }
  if (message.content.kind === "target-suggestion") {
    return `建议选择 ${message.content.target.number} 号${message.content.target.nickname}`;
  }
  return message.content.code === "agree"
    ? "赞同"
    : message.content.code === "disagree"
      ? "反对"
      : "建议空刀";
}

export function ChatTimeline({
  messages,
  emptyText,
  className = ""
}: {
  messages: ChatMessage[];
  emptyText: string;
  className?: string;
}) {
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (timeline) timeline.scrollTop = timeline.scrollHeight;
  }, [messages.length]);

  return (
    <div className={`chat-timeline ${className}`.trim()} ref={timelineRef} aria-live="polite">
      {messages.length === 0 ? <p className="chat-empty">{emptyText}</p> : messages.map((message) => (
        <article className="chat-message" key={message.id}>
          <span>
            {message.sender.kind === "system"
              ? message.sender.label
              : `${message.sender.number} 号 · ${message.sender.nickname}`}
          </span>
          <p>{chatMessageText(message)}</p>
        </article>
      ))}
    </div>
  );
}
