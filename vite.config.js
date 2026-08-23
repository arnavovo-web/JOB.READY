import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Phase 2A: plain-JS unit tests (methodology.js et al.) — no DOM/React
  // rendering needed, so no jsdom/happy-dom environment is configured.
  test: {
    environment: "node",
  },
});
