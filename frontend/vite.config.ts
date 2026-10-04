import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    host: true,           // listen on all interfaces so LAN devices (phone) can reach it
    port: 5175,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5274",
        changeOrigin: true,
      },
    },
  },
});
