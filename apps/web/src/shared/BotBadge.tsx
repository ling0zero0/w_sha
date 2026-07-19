import { Bot } from "lucide-react";

export function BotBadge() {
  return (
    <span className="controller-badge" title="确定性机器人">
      <Bot size={12} aria-hidden="true" />
      机器人
    </span>
  );
}
