import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Radio,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UsersRound,
  Wifi
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { getSurface } from "./routing";
import { useServiceConnection } from "./useServiceConnection";

type Status = "checking" | "connected" | "disconnected";

const statusText: Record<Status, string> = {
  checking: "检测中",
  connected: "运行中",
  disconnected: "未连接"
};

function StatusMark({ status }: { status: Status }) {
  const Icon = status === "connected" ? CircleCheck : status === "disconnected" ? CircleAlert : RefreshCw;
  return <Icon aria-hidden="true" className={status === "checking" ? "spin" : ""} size={18} />;
}

function HostScreen() {
  const connection = useServiceConnection();
  const socketText = connection.socket === "connected" ? "已连接" : statusText[connection.socket];

  return (
    <main className="host-shell">
      <div className="night-scene" aria-hidden="true">
        <span className="moon" />
        <span className="ridge ridge-back" />
        <span className="ridge ridge-front" />
        <span className="village-lights" />
      </div>

      <header className="topbar">
        <a className="brand" href="/" aria-label="局域网狼人杀主机主页">
          <ShieldCheck size={24} aria-hidden="true" />
          <span>局域网狼人杀</span>
        </a>
        <span className="stage-tag">项目骨架 · 阶段 1</span>
      </header>

      <section className="host-content">
        <div className="host-heading">
          <p className="eyebrow">主机公共屏幕</p>
          <h1>局域网狼人杀</h1>
          <p className="host-lead">服务基础设施已就绪。房间创建与扫码加入将在下一阶段开放。</p>
        </div>

        <div className="status-panel" aria-label="服务状态">
          <div className={`status-row status-${connection.api}`}>
            <span className="status-icon"><StatusMark status={connection.api} /></span>
            <span><strong>HTTP 服务</strong><small>共享状态与基础接口</small></span>
            <b data-testid="api-status">{statusText[connection.api]}</b>
          </div>
          <div className={`status-row status-${connection.socket}`}>
            <span className="status-icon"><Radio size={18} aria-hidden="true" /></span>
            <span><strong>实时通道</strong><small>Socket.IO 双向连接</small></span>
            <b data-testid="socket-status">{socketText}</b>
          </div>
        </div>

        <div className="host-actions">
          <a className="primary-action" href="/join">
            <Smartphone size={20} aria-hidden="true" />
            打开玩家入口
            <ArrowRight size={18} aria-hidden="true" />
          </a>
          <div className="privacy-note">
            <ShieldCheck size={19} aria-hidden="true" />
            公共屏幕仅接收公开状态
          </div>
        </div>
      </section>

      <footer className="host-footer">
        <span><Wifi size={16} aria-hidden="true" /> 本机服务端口 3000</span>
        <span><UsersRound size={16} aria-hidden="true" /> 等待房间模块</span>
      </footer>
    </main>
  );
}

function PlayerScreen() {
  const connection = useServiceConnection();
  const [message, setMessage] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("当前没有开放的房间");
  }

  return (
    <main className="player-shell">
      <header className="player-header">
        <a className="brand dark-brand" href="/">
          <ShieldCheck size={22} aria-hidden="true" />
          <span>局域网狼人杀</span>
        </a>
        <span className={`connection-pill status-${connection.socket}`}>
          <span />
          {connection.socket === "connected" ? "服务已连接" : "正在连接"}
        </span>
      </header>

      <section className="join-layout">
        <div className="join-intro">
          <p className="eyebrow">玩家入口</p>
          <h1>加入房间</h1>
          <p>输入主机屏幕上的房间号和你的昵称。</p>
        </div>

        <form className="join-form" onSubmit={submit}>
          <label htmlFor="room-code">房间号</label>
          <input id="room-code" name="roomCode" inputMode="numeric" maxLength={6} placeholder="6 位房间号" required />

          <label htmlFor="nickname">昵称</label>
          <input id="nickname" name="nickname" maxLength={12} placeholder="1 至 12 个字符" required />

          <button type="submit">
            查找房间
            <ArrowRight size={19} aria-hidden="true" />
          </button>
          {message ? <p className="form-message" role="status">{message}</p> : null}
        </form>

        <div className="player-security">
          <ShieldCheck size={20} aria-hidden="true" />
          <span><strong>信息仅在局域网内传输</strong><small>身份与操作由服务端统一验证</small></span>
        </div>
      </section>
    </main>
  );
}

export function App() {
  return getSurface(window.location.pathname) === "player" ? <PlayerScreen /> : <HostScreen />;
}

