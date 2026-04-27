import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readKubeContexts, readKubeSnapshot, readResourceDetails, runPodAction } from "./dev/kubeSnapshot";

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
      server.middlewares.use("/api/kube/contexts", async (_request, response) => {
        try {
          const contexts = await readKubeContexts();
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(contexts));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : "kubectl failed" }));
        }
      });
      server.middlewares.use("/api/kube/snapshot", async (_request, response) => {
        try {
          const url = new URL(_request.url ?? "", "http://localhost");
          const snapshot = await readKubeSnapshot(url.searchParams.get("context") ?? undefined);
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(snapshot));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : "kubectl failed" }));
        }
      });
      server.middlewares.use("/api/kube/details", async (request, response) => {
        try {
          const url = new URL(request.url ?? "", "http://localhost");
          const details = await readResourceDetails({
            kind: url.searchParams.get("kind") ?? "",
            name: url.searchParams.get("name") ?? "",
            namespace: url.searchParams.get("namespace") ?? "",
            cluster: url.searchParams.get("cluster") ?? "",
          });
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(details));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : "kubectl failed" }));
        }
      });
      server.middlewares.use("/api/kube/pod-action", async (request, response) => {
        try {
          if (request.method !== "POST") {
            response.statusCode = 405;
            response.end();
            return;
          }
          const payload = await readJsonBody(request);
          const result = await runPodAction(payload);
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(result));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : "kubectl failed" }));
        }
      });
    },
  };
}

async function readJsonBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
