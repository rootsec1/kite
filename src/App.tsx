import { AppShell } from "./components/AppShell";
import { useKiteData } from "./hooks/useKiteData";

export function App() {
  const data = useKiteData();
  const usesNativeWindowControls = "__TAURI_INTERNALS__" in window;

  return <AppShell data={data} usesNativeWindowControls={usesNativeWindowControls} />;
}
