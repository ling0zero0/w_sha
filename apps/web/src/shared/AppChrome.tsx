import { Radio, ShieldCheck, Timer, Wifi } from "lucide-react";
import type { PublicGameState, PublicPhaseClock } from "@werewolf/shared";
import { useEffect, useState } from "react";
import { formatRemainingMs, getRemainingMs } from "../phase-clock";

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="局域网狼人杀主机主页">
      <ShieldCheck size={23} aria-hidden="true" />
      <span>局域网狼人杀</span>
    </a>
  );
}

export function PhaseClockDisplay({ clock }: { clock: PublicPhaseClock }) {
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (clock.status !== "running") return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [clock.status, clock.deadlineAt]);

  const statusText = clock.status === "running" ? "阶段进行中"
    : clock.status === "paused" ? "阶段已暂停"
      : clock.status === "ended" ? "阶段已结束" : "阶段计时未开始";

  return (
    <div className={`phase-clock phase-clock-${clock.status}`}>
      <span><Timer size={18} aria-hidden="true" />{statusText}</span>
      <strong data-testid="phase-clock">{formatRemainingMs(getRemainingMs(clock, nowMs))}</strong>
    </div>
  );
}

export function InterventionNotices({ game }: { game: PublicGameState }) {
  const latest = game.interventions.at(-1);
  if (!latest) return null;

  return (
    <div className="intervention-notice" aria-live="polite" data-testid="intervention-notice">
      <ShieldCheck size={17} aria-hidden="true" />
      <span><small>主机操作</small>{latest.detail}</span>
    </div>
  );
}

export function HostConnectionStatus({ api, socket }: {
  api: "checking" | "connected" | "disconnected";
  socket: "checking" | "connected" | "disconnected";
}) {
  return (
    <div className="host-statuses">
      <span className={`status-chip status-${api}`}>
        <Wifi size={15} aria-hidden="true" />
        服务{api === "connected" ? "正常" : api === "checking" ? "检测中" : "中断"}
      </span>
      <span className={`status-chip status-${socket}`} data-testid="socket-status">
        <Radio size={15} aria-hidden="true" />
        实时{socket === "connected" ? "已连接" : socket === "checking" ? "连接中" : "已断开"}
      </span>
    </div>
  );
}
