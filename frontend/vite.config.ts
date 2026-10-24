import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": "http://127.0.0.1:8100",
      "/healthz": "http://127.0.0.1:8100",
      "/readyz": "http://127.0.0.1:8100",
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
