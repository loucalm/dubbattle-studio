import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Interface du Studio. En développement (npm run dev), Vite sert l'interface sur le port 5181
// et relaie /api vers le serveur du Studio (5180).
export default defineConfig({
  root: "web",
  plugins: [svelte()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: {
    port: 5181,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:5180" } },
  },
});
