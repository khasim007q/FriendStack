import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_SHARED_HOSTING": JSON.stringify(
      process.env.VERCEL === "1",
    ),
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": { target: "ws://127.0.0.1:3001", ws: true, xfwd: true },
      "/api": { target: "http://127.0.0.1:3001", xfwd: true },
    },
  },
});
