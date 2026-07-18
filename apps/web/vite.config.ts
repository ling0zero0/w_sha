import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@werewolf/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url))
    }
  },
  server: {
    host: "0.0.0.0",
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.PORT ?? 3000}`,
        configure(proxy) {
          proxy.on("proxyReq", (proxyRequest, request) => {
            proxyRequest.setHeader(
              "x-werewolf-proxy-client-ip",
              request.socket.remoteAddress ?? ""
            );
          });
        }
      },
      "/socket.io": {
        target: `ws://127.0.0.1:${process.env.PORT ?? 3000}`,
        ws: true
      }
    }
  }
});
