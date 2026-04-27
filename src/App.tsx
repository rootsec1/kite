import { AppShell } from "./components/AppShell";
import { useKiteData } from "./hooks/useKiteData";

export function App() {
  const data = useKiteData();

  return <AppShell data={data} />;
}
