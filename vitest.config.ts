import { defineConfig } from "vitest/config";

// Tests de la logique pure (commun/) et du contrat avec les schémas des extraits (tests/).
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
