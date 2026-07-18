import { HostScreen } from "./host/HostScreen";
import { PlayerScreen } from "./player/PlayerScreen";
import { getSurface } from "./routing";

export function App() {
  return getSurface(window.location.pathname) === "player" ? <PlayerScreen /> : <HostScreen />;
}
