// Accès aux fichiers de la machine : explorateur pour choisir une vidéo source, recherche d'une
// source déplacée ou renommée (par taille puis empreinte), et réglages du Studio.

import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, extname, join, parse, resolve } from "node:path";
import { config } from "./config.ts";
import { Annulation } from "./processus.ts";
import type { EntreeDossier } from "../commun/types.ts";

export const EXTENSIONS_VIDEO = new Set([".mp4", ".mkv", ".mov", ".webm", ".m4v", ".avi", ".ts", ".m2ts", ".mpg", ".mpeg", ".wmv", ".flv"]);
const DOSSIERS_IGNORES = new Set(["node_modules", ".git", "$recycle.bin", "system volume information", "windows", "program files", "program files (x86)", "appdata"]);

// ---------------------------------------------------------------------------
// Réglages (studio-workspace/reglages.json)
// ---------------------------------------------------------------------------

export interface Reglages {
  /** dossiers où sont rangées les vidéos sources (disque externe…) */
  dossiers_sources: string[];
}

const cheminReglages = () => join(config.dossierEspace, "reglages.json");

export async function lireReglages(): Promise<Reglages> {
  try {
    const r = JSON.parse(await readFile(cheminReglages(), "utf8")) as Partial<Reglages>;
    return { dossiers_sources: Array.isArray(r.dossiers_sources) ? r.dossiers_sources : [] };
  } catch {
    return { dossiers_sources: [] };
  }
}

export async function ecrireReglages(reglages: Reglages): Promise<Reglages> {
  const propres: Reglages = {
    dossiers_sources: [...new Set(reglages.dossiers_sources.map((d) => resolve(d.trim())).filter((d) => d.length > 3))],
  };
  await mkdir(config.dossierEspace, { recursive: true });
  await writeFile(cheminReglages(), JSON.stringify(propres, null, 2), "utf8");
  return propres;
}

// ---------------------------------------------------------------------------
// Explorateur
// ---------------------------------------------------------------------------

export interface ContenuDossier {
  chemin: string | null;
  parent: string | null;
  entrees: EntreeDossier[];
}

/** Sans chemin : la liste des lecteurs (Windows) ou la racine. Ne montre que les dossiers et les vidéos. */
export async function listerDossier(chemin?: string): Promise<ContenuDossier> {
  if (!chemin) {
    if (process.platform !== "win32") return listerDossier("/");
    const lecteurs: EntreeDossier[] = [];
    for (const lettre of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
      const racine = `${lettre}:\\`;
      if (existsSync(racine)) lecteurs.push({ nom: `${lettre}:`, chemin: racine, dossier: true, taille_octets: null });
    }
    return { chemin: null, parent: null, entrees: lecteurs };
  }
  const dossier = resolve(chemin);
  const noms = await readdir(dossier, { withFileTypes: true });
  const entrees: EntreeDossier[] = [];
  for (const n of noms) {
    if (n.name.startsWith(".") || n.name.startsWith("$")) continue;
    const complet = join(dossier, n.name);
    if (n.isDirectory()) {
      entrees.push({ nom: n.name, chemin: complet, dossier: true, taille_octets: null });
    } else if (n.isFile() && EXTENSIONS_VIDEO.has(extname(n.name).toLowerCase())) {
      try {
        entrees.push({ nom: n.name, chemin: complet, dossier: false, taille_octets: (await stat(complet)).size });
      } catch {
        // fichier inaccessible : ignoré
      }
    }
  }
  entrees.sort((a, b) => Number(b.dossier) - Number(a.dossier) || a.nom.localeCompare(b.nom, "fr", { numeric: true }));
  const racine = parse(dossier).root;
  return { chemin: dossier, parent: dossier === racine ? null : dirname(dossier), entrees };
}

// ---------------------------------------------------------------------------
// Recherche de fichiers
// ---------------------------------------------------------------------------

/** Parcourt les dossiers sources (profondeur limitée) et renvoie les fichiers qui passent le filtre. */
async function parcourir(
  dossiers: string[],
  filtre: (nom: string, taille: number) => boolean,
  signal?: AbortSignal,
  profondeurMax = 6,
): Promise<string[]> {
  const trouves: string[] = [];
  const pile = dossiers.map((d) => ({ chemin: d, profondeur: 0 }));
  let visites = 0;
  while (pile.length > 0 && visites < 20_000) {
    if (signal?.aborted) throw new Annulation();
    const { chemin, profondeur } = pile.pop()!;
    visites++;
    let entrees;
    try {
      entrees = await readdir(chemin, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entrees) {
      const complet = join(chemin, e.name);
      if (e.isDirectory()) {
        if (profondeur < profondeurMax && !DOSSIERS_IGNORES.has(e.name.toLowerCase()) && !e.name.startsWith(".")) {
          pile.push({ chemin: complet, profondeur: profondeur + 1 });
        }
      } else if (e.isFile() && EXTENSIONS_VIDEO.has(extname(e.name).toLowerCase())) {
        try {
          if (filtre(e.name, (await stat(complet)).size)) trouves.push(complet);
        } catch {
          // ignoré
        }
      }
    }
  }
  return trouves;
}

/** Glisser-déposer : le navigateur ne donne que le nom et la taille, on retrouve le chemin. */
export async function chercherParNomEtTaille(nom: string, taille: number): Promise<string[]> {
  const { dossiers_sources } = await lireReglages();
  return parcourir(dossiers_sources, (n, t) => n === nom && t === taille);
}

/** Source déplacée ou renommée : mêmes taille et empreinte. */
export async function chercherParEmpreinte(
  empreinte: string,
  taille: number,
  suivi: { signal?: AbortSignal; progression?: (v: number | null, detail?: string) => void },
): Promise<string | null> {
  const { dossiers_sources } = await lireReglages();
  suivi.progression?.(null, "Recherche des fichiers de même taille");
  const candidats = await parcourir(dossiers_sources, (_, t) => t === taille, suivi.signal);
  for (const [i, chemin] of candidats.entries()) {
    suivi.progression?.(i / candidats.length, `Vérification de ${parse(chemin).base}`);
    if ((await empreinteFichier(chemin, { signal: suivi.signal })) === empreinte) return chemin;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Empreinte
// ---------------------------------------------------------------------------

export async function empreinteFichier(
  chemin: string,
  suivi: { signal?: AbortSignal; progression?: (v: number | null) => void } = {},
): Promise<string> {
  const { size } = await stat(chemin);
  const hash = createHash("sha256");
  let lus = 0;
  let dernier = 0;
  const flux = createReadStream(chemin, { highWaterMark: 4 * 1024 * 1024 });
  for await (const morceau of flux) {
    if (suivi.signal?.aborted) {
      flux.destroy();
      throw new Annulation();
    }
    hash.update(morceau as Buffer);
    lus += (morceau as Buffer).length;
    if (suivi.progression && lus - dernier > 64 * 1024 * 1024) {
      dernier = lus;
      suivi.progression(lus / size);
    }
  }
  return `sha256:${hash.digest("hex")}`;
}
