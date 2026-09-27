// Serveur local du Studio : l'API (/api) et l'interface compilée (dist/web).
// Lancement : npm run studio, puis http://localhost:5180

import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join, normalize, sep } from "node:path";
import { config, dossierWeb } from "./config.ts";
import { envoyerFichier, envoyerJson } from "./http.ts";
import { routeur } from "./routes.ts";

// Le Studio lit et écrit des fichiers locaux : il n'accepte que les pages servies par la machine
// elle-même (protection contre le « DNS rebinding » depuis un site tiers).
const HOTES_LOCAUX = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

await mkdir(config.dossierEspace, { recursive: true });

const serveur = createServer(async (req, res) => {
  try {
    if (!HOTES_LOCAUX.test(req.headers.host ?? "")) {
      return envoyerJson(res, 403, { erreur: "Accès réservé à la machine locale." });
    }
    if ((req.url ?? "").startsWith("/api/")) {
      if (!(await routeur.traiter(req, res))) envoyerJson(res, 404, { erreur: "Route inconnue." });
      return;
    }
    // Interface compilée, avec repli sur index.html (application d'une seule page)
    if (!existsSync(dossierWeb)) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Interface non compilée : lance « npm run studio » (ou « npm run dev » pour développer).");
    }
    const demande = normalize(join(dossierWeb, decodeURIComponent(new URL(req.url ?? "/", "http://l").pathname)));
    let fichier = join(dossierWeb, "index.html");
    if (demande.startsWith(dossierWeb + sep) && statSync(demande, { throwIfNoEntry: false })?.isFile()) fichier = demande;
    const immuable = fichier.startsWith(join(dossierWeb, "assets") + sep);
    await envoyerFichier(req, res, fichier, { cache: immuable ? "public, max-age=31536000, immutable" : "no-cache" });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) envoyerJson(res, 500, { erreur: (e as Error).message });
  }
});

serveur.listen(config.port, config.hote, () => {
  console.log(`Studio Dub-Battle : http://localhost:${config.port}`);
  console.log(`  extraits : ${config.dossierExtraits}`);
  console.log(`  espace de travail : ${config.dossierEspace}`);
});
