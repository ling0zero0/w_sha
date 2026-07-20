import { AiManagementScreen } from "./ai/AiManagementScreen";
import { HostScreen } from "./host/HostScreen";
import { PlayerScreen } from "./player/PlayerScreen";
import { getSurface } from "./routing";

export function App() {
  const surface = getSurface(window.location.pathname);

  if (surface === "player") return <PlayerScreen />;
  if (surface === "ai") return <AiManagementScreen />;
  if (surface === "host") return <HostScreen />;

  return (
    <main className="not-found-screen">
      <p className="eyebrow">404</p>
      <h1>页面不存在</h1>
      <a href="/">返回主持人大厅</a>
    </main>
  );
}
