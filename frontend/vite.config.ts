/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": process.env.CHORUS_API ?? "http://localhost:8000" } }, // CHORUS_API: point the dev server at another backend
  test: { globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
