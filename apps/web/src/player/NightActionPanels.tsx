import type { FormEvent } from "react";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  PrivateGuardAction,
  PrivateHunterAction,
  PrivateWitchAction,
  PrivateWolfAction,
  WolfSendMessageRequest
} from "@werewolf/shared";

export function GuardActionPanel({
  action,
  paused,
  connected,
  onSubmit
}: {
  action: PrivateGuardAction;
  paused: boolean;
  connected: boolean;
  onSubmit: (target: string | null) => void;
}) {
  const [target, setTarget] = useState<string | null>(action.protectedPlayer?.id ?? null);

  useEffect(() => {
    setTarget(action.protectedPlayer?.id ?? null);
  }, [action.protectedPlayer?.id, action.active]);

  return (
    <div className="night-role-panel guard-action-panel">
      <h2>选择今晚守护的玩家</h2>
      <p>选择一名玩家进行守护。提交后本夜不可修改。</p>
      {action.submitted ? (
        <div className="role-confirmed">
          <Check size={18} aria-hidden="true" />
          {action.protectedPlayer
            ? `已守护 ${action.protectedPlayer.number} 号 · ${action.protectedPlayer.nickname}`
            : "守护目标已提交"}
        </div>
      ) : (
        <>
          <div className="night-targets">
            {action.candidates.map((candidate) => (
              <button
                className={target === candidate.id ? "is-selected" : ""}
                type="button"
                key={candidate.id}
                disabled={paused || !action.active}
                onClick={() => setTarget(candidate.id)}
              >
                <span>{String(candidate.number).padStart(2, "0")}</span>{candidate.nickname}
              </button>
            ))}
          </div>
          <button
            className="confirm-role-button"
            type="button"
            disabled={!connected || paused || !action.active || !target}
            onClick={() => target && onSubmit(target)}
          >提交守护目标</button>
          <button
            className="night-secondary-button"
            type="button"
            disabled={!connected || paused || !action.active}
            onClick={() => onSubmit(null)}
          >今晚空守</button>
        </>
      )}
    </div>
  );
}

export function HunterActionPanel({
  action,
  connected,
  paused,
  onSubmit
}: {
  action: PrivateHunterAction;
  connected: boolean;
  paused: boolean;
  onSubmit: (target: string | null) => void;
}) {
  const [target, setTarget] = useState<string | null>(action.shotPlayer?.id ?? null);

  useEffect(() => {
    setTarget(action.shotPlayer?.id ?? null);
  }, [action.shotPlayer?.id, action.active]);

  return (
    <section className="hunter-action-panel" aria-labelledby="hunter-action-title">
      <p className="eyebrow">猎人技能</p>
      <h2 id="hunter-action-title">选择开枪目标</h2>
      <p>你可以带走一名仍可选择的玩家，也可以放弃开枪。提交后不可修改。</p>
      {action.submitted ? (
        <div className="hunter-action-result">
          <Check size={18} aria-hidden="true" />
          {action.shotPlayer
            ? `已选择 ${action.shotPlayer.number} 号 · ${action.shotPlayer.nickname}`
            : "已放弃开枪"}
        </div>
      ) : (
        <>
          <div className="hunter-targets">
            {action.candidates.map((candidate) => (
              <button
                className={target === candidate.id ? "is-selected" : ""}
                type="button"
                key={candidate.id}
                disabled={!connected || paused || !action.active}
                onClick={() => setTarget(candidate.id)}
              >
                <span>{String(candidate.number).padStart(2, "0")}</span>{candidate.nickname}
              </button>
            ))}
          </div>
          <div className="hunter-action-buttons">
            <button type="button" disabled={!connected || paused || !action.active || !target} onClick={() => target && onSubmit(target)}>确认开枪</button>
            <button type="button" disabled={!connected || paused || !action.active} onClick={() => onSubmit(null)}>放弃开枪</button>
          </div>
        </>
      )}
    </section>
  );
}

export function WitchActionPanel({
  action,
  paused,
  onSubmit
}: {
  action: PrivateWitchAction;
  paused: boolean;
  onSubmit: (choice: "none" | "save" | "poison", target?: string) => void;
}) {
  const [poisonTarget, setPoisonTarget] = useState<string | null>(null);

  return (
    <div className="night-role-panel witch-action-panel">
      <h2>女巫行动</h2>
      <p>{action.attackedPlayer
        ? `今晚 ${action.attackedPlayer.number} 号 · ${action.attackedPlayer.nickname} 被狼人袭击。`
        : "今晚无人被狼人袭击。"}</p>
      <div className="witch-tools">
        <button
          type="button"
          disabled={paused || !action.antidoteAvailable || !action.attackedPlayer}
          onClick={() => onSubmit("save")}
        >使用解药</button>
        <button type="button" disabled={paused} className="secondary-night-action" onClick={() => onSubmit("none")}>不使用药物</button>
      </div>
      {action.poisonAvailable ? (
        <div className="poison-choice">
          <span>或选择一名玩家使用毒药</span>
          <div className="night-targets">
            {action.poisonCandidates.map((candidate) => (
              <button
                className={poisonTarget === candidate.id ? "is-selected" : ""}
                type="button"
                key={candidate.id}
                disabled={paused}
                onClick={() => setPoisonTarget(candidate.id)}
              >
                <span>{String(candidate.number).padStart(2, "0")}</span>{candidate.nickname}
              </button>
            ))}
          </div>
          <button
            className="confirm-role-button poison-submit"
            type="button"
            disabled={paused || !poisonTarget}
            onClick={() => poisonTarget && onSubmit("poison", poisonTarget)}
          >确认使用毒药</button>
        </div>
      ) : null}
    </div>
  );
}

export function WolfChatPanel({
  action,
  paused,
  onSend
}: {
  action: PrivateWolfAction;
  paused: boolean;
  onSend: (payload: WolfSendMessageRequest) => void;
}) {
  const [message, setMessage] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    onSend({ kind: "text", text });
    setMessage("");
  }

  return (
    <section className="wolf-chat" aria-label="狼人私密聊天">
      <header><span>狼人私密协作</span><small>{paused ? "阶段已暂停" : action.chatEnabled ? "仅狼人可见" : "本夜聊天已关闭"}</small></header>
      <div className="wolf-messages" aria-live="polite">
        {action.messages.length === 0 ? <p>还没有消息，可以先发送快捷建议。</p> : action.messages.map((item) => (
          <article key={item.id}>
            <span>{item.sender.number} 号 · {item.sender.nickname}</span>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
      <div className="wolf-quick-messages">
        <button type="button" disabled={paused || !action.chatEnabled} onClick={() => onSend({ kind: "quick", code: "agree" })}>赞同</button>
        <button type="button" disabled={paused || !action.chatEnabled} onClick={() => onSend({ kind: "quick", code: "disagree" })}>反对</button>
        <button type="button" disabled={paused || !action.chatEnabled} onClick={() => onSend({ kind: "quick", code: "no-kill" })}>建议空刀</button>
        <button
          type="button"
          disabled={paused || !action.chatEnabled || !action.target || action.target === "no-kill"}
          onClick={() => action.target && action.target !== "no-kill" && onSend({ kind: "target-suggestion", target: action.target })}
        >建议当前目标</button>
      </div>
      <form className="wolf-chat-form" onSubmit={submit}>
        <input
          value={message}
          maxLength={80}
          disabled={paused || !action.chatEnabled}
          placeholder="输入狼人私密消息"
          aria-label="狼人私密消息"
          onChange={(event) => setMessage(event.target.value)}
        />
        <button type="submit" disabled={paused || !action.chatEnabled || !message.trim()}>发送</button>
      </form>
    </section>
  );
}
