// Étape 3 : retouche des pistes dans un autre logiciel (fiche 7.5). On télécharge une piste
// (original, voice ou bed), on la retouche (Audacity, Reaper…), puis on la réimporte : le Studio
// la compare au mélange original pour la recaler, puis la remet aux normes.

import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { decoderMono, dureeAudio, exporterWav, normaliserImport } from "./ffmpeg.ts";
import { empreinteFichier } from "./fichiers.ts";
import { chemins, ErreurHttp, lireProjet, modifierProjet } from "./projets.ts";
import type { ContexteTache } from "./taches.ts";
import { mixAJour, preparerMix } from "./travaux.ts";
import { trouverDecalage } from "../commun/correlation.ts";
import { dureeExtrait } from "../commun/publication.ts";
import type { AnalyseImport, Projet } from "../commun/types.ts";

export const EXTENSIONS_AUDIO = [".wav", ".flac", ".aif", ".aiff", ".mp3", ".m4a", ".aac", ".ogg", ".opus"];
/** Recalage cherché jusqu'à ±1 s ; en dessous de 5 ms, on ne propose pas de recaler. */
const DECALAGE_MAX_MS = 1000;
const FREQUENCE_COMPARAISON = 8000;

const muet = (): ContexteTache => ({ signal: new AbortController().signal, progression: () => {}, terminer: () => {} });
const dossierBrut = (id: string) => join(chemins(id).imports, "brut");

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** WAV de travail d'une piste de l'étape 3, et le nom proposé au téléchargement. */
function pisteATelecharger(p: Projet, piste: string): { source: string; nom: string } {
  const c = chemins(p.id);
  if (piste === "original") {
    if (!mixAJour(p)) throw new ErreurHttp(404, "L'audio original de la plage n'est pas encore extrait.");
    return { source: c.mix, nom: `${p.id}_original.wav` };
  }
  const separation = /^separation-(.+)-(voice|bed)$/.exec(piste);
  if (separation) {
    const s = p.separations.find((x) => x.id === separation[1]);
    if (s) {
      const modele = s.modele.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-");
      return { source: join(c.separation(s.id), `${separation[2]}.wav`), nom: `${p.id}_${separation[2]}_${modele}.wav` };
    }
  }
  const imp = /^import-(.+)$/.exec(piste);
  if (imp) {
    const i = p.imports.find((x) => x.id === imp[1]);
    if (i) return { source: c.importWav(i.id), nom: `${p.id}_${i.quoi}_retouche.wav` };
  }
  throw new ErreurHttp(404, "Piste inconnue.");
}

/** Prépare la copie à retoucher : WAV 48 kHz 24 bits, à la durée exacte de l'extrait. */
export async function exporterPiste(id: string, piste: string): Promise<{ chemin: string; nom: string }> {
  const p = await lireProjet(id);
  const { source, nom } = pisteATelecharger(p, piste);
  if (!existsSync(source)) throw new ErreurHttp(404, "Fichier de travail introuvable.");
  await mkdir(chemins(id).exports, { recursive: true });
  const chemin = join(chemins(id).exports, nom);
  await exporterWav(source, chemin, dureeExtrait(p));
  return { chemin, nom };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

interface ImportEnAttente {
  import: string;
  quoi: "voice" | "bed";
  nom: string;
  extension: string;
  empreinte: string;
  duree_ms: number;
}

/** Reçoit le fichier, le mesure et cherche son décalage. Rien n'est encore choisi. */
export async function recevoirImport(
  id: string,
  quoi: "voice" | "bed",
  nom: string,
  flux: AsyncIterable<Buffer>,
): Promise<AnalyseImport> {
  let p = await lireProjet(id);
  if (!p.decoupe) throw new ErreurHttp(400, "Fais d'abord la découpe (étape 2).");
  const extension = extname(nom).toLowerCase();
  if (!EXTENSIONS_AUDIO.includes(extension)) {
    throw new ErreurHttp(400, `Format non pris en charge. Formats acceptés : ${EXTENSIONS_AUDIO.join(", ")}.`);
  }

  const dossier = dossierBrut(id);
  await mkdir(dossier, { recursive: true });
  await nettoyerImportsEnAttente(id);
  const pris = new Set([...p.imports.map((i) => i.id), ...(await readdir(dossier)).map((f) => f.replace(/\.[^.]+$/, ""))]);
  let n = 1;
  while (pris.has(`${quoi}-${n}`)) n++;
  const iid = `${quoi}-${n}`;
  const brut = join(dossier, `${iid}${extension}`);

  const sortie = createWriteStream(brut);
  try {
    for await (const morceau of flux) if (!sortie.write(morceau)) await new Promise((r) => sortie.once("drain", r));
    await new Promise<void>((ok, ko) => sortie.end((e?: Error | null) => (e ? ko(e) : ok())));
  } catch (e) {
    sortie.destroy();
    await rm(brut, { force: true });
    throw e;
  }

  let duree_ms: number;
  try {
    duree_ms = await dureeAudio(brut);
  } catch {
    await rm(brut, { force: true });
    throw new ErreurHttp(400, "Fichier audio illisible.");
  }

  // comparaison avec le mélange original pour détecter un blanc ajouté au début
  let decalage_ms: number | null = null;
  let confiance: number | null = null;
  if (!mixAJour(p) && p.source.chemin && existsSync(p.source.chemin)) p = await preparerMix(id, muet());
  if (mixAJour(p)) {
    const attendu = dureeExtrait(p);
    const [ref, piste] = await Promise.all([
      decoderMono(chemins(id).mix, FREQUENCE_COMPARAISON),
      decoderMono(brut, FREQUENCE_COMPARAISON, attendu + DECALAGE_MAX_MS),
    ]);
    const r = trouverDecalage(ref, piste, FREQUENCE_COMPARAISON, DECALAGE_MAX_MS);
    decalage_ms = r.decalage_ms;
    confiance = Math.round(r.confiance * 100) / 100;
  }

  const attente: ImportEnAttente = { import: iid, quoi, nom, extension, empreinte: await empreinteFichier(brut), duree_ms };
  await writeFile(join(dossier, `${iid}.json`), JSON.stringify(attente), "utf8");
  return { import: iid, quoi, nom, duree_ms, attendu_ms: dureeExtrait(p), decalage_ms, confiance };
}

/** Met la piste aux normes (recalage, durée, 48 kHz stéréo) et la choisit pour la voice ou le bed. */
export async function validerImport(id: string, iid: string, decalageMs: number): Promise<Projet> {
  const dossier = dossierBrut(id);
  let attente: ImportEnAttente;
  try {
    attente = JSON.parse(await readFile(join(dossier, `${iid}.json`), "utf8")) as ImportEnAttente;
  } catch {
    throw new ErreurHttp(404, "Import introuvable : réimporte le fichier.");
  }
  if (!Number.isFinite(decalageMs) || Math.abs(decalageMs) > 10_000) throw new ErreurHttp(400, "Décalage invalide.");
  let p = await lireProjet(id);
  if (!p.decoupe) throw new ErreurHttp(400, "Fais d'abord la découpe (étape 2).");
  // le gain se mesure sur le mélange original : il faut la source si ce n'est pas déjà fait
  if (p.gain_db === null) {
    if (!p.source.chemin || !existsSync(p.source.chemin)) {
      throw new ErreurHttp(400, "Il faut la vidéo source pour mesurer le volume (étape 1).");
    }
    p = await preparerMix(id, muet());
  }

  const brut = join(dossier, `${iid}${attente.extension}`);
  const dest = chemins(id).importWav(iid);
  await normaliserImport(brut, dest, dureeExtrait(p), Math.round(decalageMs));
  const decoupe = { ...p.decoupe! };
  const projet = await modifierProjet(id, (q) => {
    q.imports = q.imports.filter((i) => i.id !== iid);
    q.imports.push({
      id: iid,
      quoi: attente.quoi,
      nom: attente.nom,
      empreinte: attente.empreinte,
      decoupe,
      decalage_ms: Math.round(decalageMs),
      cree_le: new Date().toISOString(),
    });
    q[attente.quoi] = { origine: "import", import: iid };
  });
  await rm(brut, { force: true });
  await rm(join(dossier, `${iid}.json`), { force: true });
  return projet;
}

export async function supprimerImport(id: string, iid: string): Promise<Projet> {
  const projet = await modifierProjet(id, (p) => {
    p.imports = p.imports.filter((i) => i.id !== iid);
    for (const quoi of ["voice", "bed"] as const) {
      const choix = p[quoi];
      if (choix?.origine === "import" && choix.import === iid) p[quoi] = null;
    }
  });
  await rm(chemins(id).importWav(iid), { force: true });
  return projet;
}

/** Nettoie les imports reçus mais jamais validés (plus d'une heure). */
export async function nettoyerImportsEnAttente(id: string): Promise<void> {
  const dossier = dossierBrut(id);
  for (const f of await readdir(dossier).catch(() => [] as string[])) {
    const chemin = join(dossier, f);
    const s = await stat(chemin).catch(() => null);
    if (s && Date.now() - s.mtimeMs > 3_600_000) await rm(chemin, { force: true });
  }
}

