// Petit routeur HTTP, envoi de JSON et de fichiers (avec les requêtes « Range » pour la vidéo).

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname } from "node:path";
import { ErreurHttp } from "./projets.ts";

export interface Contexte {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  corps: () => Promise<unknown>;
}

/** Une route renvoie un objet (envoyé en JSON), ou rien si elle a répondu elle-même. */
type Gestionnaire = (ctx: Contexte) => Promise<unknown> | unknown;

interface Route {
  methode: string;
  motif: RegExp;
  noms: string[];
  gestionnaire: Gestionnaire;
}

export class Routeur {
  private routes: Route[] = [];

  private ajouter(methode: string, chemin: string, gestionnaire: Gestionnaire): void {
    const noms: string[] = [];
    const motif = new RegExp(
      `^${chemin.replace(/:(\w+)/g, (_, nom: string) => {
        noms.push(nom);
        return "([^/]+)";
      })}$`,
    );
    this.routes.push({ methode, motif, noms, gestionnaire });
  }

  get(chemin: string, g: Gestionnaire) {
    this.ajouter("GET", chemin, g);
  }
  post(chemin: string, g: Gestionnaire) {
    this.ajouter("POST", chemin, g);
  }
  patch(chemin: string, g: Gestionnaire) {
    this.ajouter("PATCH", chemin, g);
  }
  put(chemin: string, g: Gestionnaire) {
    this.ajouter("PUT", chemin, g);
  }
  delete(chemin: string, g: Gestionnaire) {
    this.ajouter("DELETE", chemin, g);
  }

  /** Renvoie false si aucune route ne correspond. */
  async traiter(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    for (const route of this.routes) {
      if (route.methode !== req.method) continue;
      const m = route.motif.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.noms.forEach((nom, i) => (params[nom] = decodeURIComponent(m[i + 1])));
      try {
        const resultat = await route.gestionnaire({ req, res, params, query: url.searchParams, corps: () => lireCorps(req) });
        if (!res.headersSent && !res.writableEnded) envoyerJson(res, 200, resultat ?? { ok: true });
      } catch (e) {
        const statut = e instanceof ErreurHttp ? e.statut : 500;
        if (statut === 500) console.error(`[${req.method} ${url.pathname}]`, e);
        if (!res.headersSent) envoyerJson(res, statut, { erreur: e instanceof Error ? e.message : String(e) });
        else res.end();
      }
      return true;
    }
    return false;
  }
}

async function lireCorps(req: IncomingMessage): Promise<unknown> {
  // exiger du JSON bloque les requêtes « simples » qu'une page web tierce pourrait envoyer au Studio
  if (!(req.headers["content-type"] ?? "").includes("application/json")) {
    throw new ErreurHttp(415, "Corps JSON attendu.");
  }
  const morceaux: Buffer[] = [];
  for await (const m of req) morceaux.push(m as Buffer);
  const texte = Buffer.concat(morceaux).toString("utf8");
  try {
    return texte ? JSON.parse(texte) : {};
  } catch {
    throw new ErreurHttp(400, "JSON invalide.");
  }
}

export function envoyerJson(res: ServerResponse, statut: number, donnees: unknown): void {
  const corps = JSON.stringify(donnees);
  res.writeHead(statut, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(corps),
  });
  res.end(corps);
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".bin": "application/octet-stream",
};

/**
 * Envoie le fichier et le referme dans tous les cas. Avec un simple .pipe(), une requête abandonnée
 * par le navigateur (saut dans une vidéo, rechargement) laisse le fichier ouvert : sous Windows, il
 * ne peut alors plus être remplacé, renommé ni supprimé.
 */
function diffuser(res: ServerResponse, chemin: string, options?: { start: number; end: number }): void {
  pipeline(createReadStream(chemin, options), res, () => undefined);
}

/** Envoie un fichier, en gérant les requêtes partielles (déplacement dans une vidéo). */
export async function envoyerFichier(
  req: IncomingMessage,
  res: ServerResponse,
  chemin: string,
  options: { cache?: string } = {},
): Promise<void> {
  let taille: number;
  try {
    const s = await stat(chemin);
    if (!s.isFile()) throw new Error();
    taille = s.size;
  } catch {
    throw new ErreurHttp(404, "Fichier introuvable.");
  }
  const type = TYPES[extname(chemin).toLowerCase()] ?? "application/octet-stream";
  const entetes: Record<string, string | number> = {
    "content-type": type,
    "accept-ranges": "bytes",
    "cache-control": options.cache ?? "no-cache",
  };
  const plage = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (plage && (plage[1] || plage[2])) {
    let debut = plage[1] ? Number(plage[1]) : taille - Number(plage[2]);
    let fin = plage[1] && plage[2] ? Number(plage[2]) : taille - 1;
    debut = Math.max(0, debut);
    fin = Math.min(fin, taille - 1);
    if (debut > fin) {
      res.writeHead(416, { "content-range": `bytes */${taille}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...entetes, "content-range": `bytes ${debut}-${fin}/${taille}`, "content-length": fin - debut + 1 });
    if (req.method === "HEAD") return void res.end();
    diffuser(res, chemin, { start: debut, end: fin });
    return;
  }
  res.writeHead(200, { ...entetes, "content-length": taille });
  if (req.method === "HEAD") return void res.end();
  diffuser(res, chemin);
}
