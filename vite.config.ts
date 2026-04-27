import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readKubeSnapshot } from "./dev/kubeSnapshot";

export default defineConfig({
  plugins: [react(), kubeSnapshotPlugin()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});

function kubeSnapshotPlugin() {
  return {
    name: "kite-kube-snapshot",
    configureServer(server) {
      server.middlewares.use("/api/kube/snapshot", async (_request, response) => {
        try {
          const snapshot = await readKubeSnapshot();
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(snapshot));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : "kubectl failed" }));
        }
      });
    },
  };
}
