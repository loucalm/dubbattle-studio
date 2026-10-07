// Projets de l'espace de travail : studio-workspace/<id>/projet.json et les fichiers de travail.
// Les écritures d'un même projet passent l'une après l'autre, pour ne jamais perdre de modification.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REGLAGES_ENCODAGE_DEFAUT } from "../commun/encodage.ts";
import { config } from "./config.ts";
import { diffuser } from "./evenements.ts";
import { FICHIERS_MEDIAS, type Media, type Projet, type ResumeProjet } from "../commun/types.ts";

export class ErreurHttp extends Error {
  constructor(
    readonly statut: number,
    message: string,
  ) {
    super(message);
  }
}

export function chemins(id: string) {
  const dossier = join(config.dossierEspace, id);
  return {
    dossier,
    projet: join(dossier, "projet.json"),
    apercu: join(dossier, "apercu.mp4"),
    pics: join(dossier, "pics.bin"),
    mix: join(dossier, "mix.wav"),
    separations: join(dossier, "separations"),
    separation: (sid: string) => join(dossier, "separations", sid),
    transcription: join(dossier, "transcription.json"),
    imports: join(dossier, "imports"),
    importWav: (iid: string) => join(dossier, "imports", `${iid}.wav`),
    exports: join(dossier, "export"),
    sortie: join(dossier, "sortie"),
    sortieMedia: (media: Media) => join(dossier, "sortie", FICHIERS_MEDIAS[media]),
  };
}

const cache = new Map<string, Projet>();
const files = new Map<string, Promise<unknown>>();

async function ecrireAtomique(chemin: string, contenu: string): Promise<void> {
  const temp = `${chemin}.tmp`;
  await writeFile(temp, contenu, "utf8");
  for (let essai = 0; ; essai++) {
    try {
      await rename(temp, chemin);
      return;
    } catch (e) {
      // Windows : un antivirus ou l'indexation peut bloquer le fichier un court instant
      if (essai >= 5) throw e;
      await new Promise((r) => setTimeout(r, 50 * (essai + 1)));
    }
  }
}

export function projetExiste(id: string): boolean {
  return existsSync(chemins(id).projet);
}

export async function lireProjet(id: string): Promise<Projet> {
  const enCache = cache.get(id);
  if (enCache) return structuredClone(enCache);
  let texte: string;
  try {
    texte = await readFile(chemins(id).projet, "utf8");
  } catch {
    throw new ErreurHttp(404, `Projet « ${id} » introuvable.`);
  }
  const projet = JSON.parse(texte) as Projet;
  // projets créés par une version précédente du Studio
  projet.imports ??= [];
  projet.encodage = { ...REGLAGES_ENCODAGE_DEFAUT, ...projet.encodage };
  cache.set(id, projet);
  return structuredClone(projet);
}

/** Enchaîne les opérations sur un même projet. */
function enFile<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const precedente = files.get(id) ?? Promise.resolve();
  const suivante = precedente.catch(() => undefined).then(operation);
  files.set(id, suivante);
  return suivante;
}

/** Applique une modification au projet le plus récent, l'enregistre et prévient l'interface. */
export function modifierProjet(id: string, modification: (projet: Projet) => void | Promise<void>): Promise<Projet> {
  return enFile(id, async () => {
    const projet = await lireProjet(id);
    await modification(projet);
    projet.modifie_le = new Date().toISOString();
    await ecrireAtomique(chemins(id).projet, JSON.stringify(projet, null, 2));
    cache.set(id, structuredClone(projet));
    diffuser({ type: "projet", donnees: { id } });
    return projet;
  });
}

export async function enregistrerNouveauProjet(projet: Projet): Promise<void> {
  const c = chemins(projet.id);
  if (existsSync(c.projet)) throw new ErreurHttp(409, `Le projet « ${projet.id} » existe déjà.`);
  await mkdir(c.dossier, { recursive: true });
  await ecrireAtomique(c.projet, JSON.stringify(projet, null, 2));
  cache.set(projet.id, structuredClone(projet));
  diffuser({ type: "projets", donnees: null });
}

export async function listerProjets(): Promise<ResumeProjet[]> {
  let noms: string[] = [];
  try {
    noms = await readdir(config.dossierEspace);
  } catch {
    return [];
  }
  const resumes: ResumeProjet[] = [];
  for (const nom of noms) {
    if (!existsSync(join(config.dossierEspace, nom, "projet.json"))) continue;
    try {
      const p = await lireProjet(nom);
      resumes.push({
        id: p.id,
        titre: p.infos.titre,
        duree_ms: p.decoupe ? p.decoupe.sortie_ms - p.decoupe.entree_ms : null,
        modifie_le: p.modifie_le,
        publication: p.publication,
        source_nom: p.source.nom,
      });
    } catch (e) {
      console.error(`Projet illisible : ${nom}`, e);
    }
  }
  return resumes.sort((a, b) => b.modifie_le.localeCompare(a.modifie_le));
}

export function supprimerProjet(id: string): Promise<void> {
  return enFile(id, async () => {
    cache.delete(id);
    await rm(chemins(id).dossier, { recursive: true, force: true });
    diffuser({ type: "projets", donnees: null });
  });
}

/** Avant la première publication seulement : l'id d'un extrait publié ne change plus. */
export function renommerProjet(id: string, nouvelId: string): Promise<void> {
  return enFile(id, async () => {
    const projet = await lireProjet(id);
    if (projet.publication) throw new ErreurHttp(409, "Un extrait déjà publié garde son identifiant.");
    if (existsSync(chemins(nouvelId).dossier)) throw new ErreurHttp(409, `« ${nouvelId} » est déjà pris.`);
    for (let essai = 0; ; essai++) {
      try {
        await rename(chemins(id).dossier, chemins(nouvelId).dossier);
        break;
      } catch {
        // Windows : un fichier du dossier encore ouvert (lecture vidéo) bloque le renommage un instant
        if (essai >= 8) throw new ErreurHttp(409, "Le dossier du projet est occupé : réessaie dans un instant.");
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    cache.delete(id);
    projet.id = nouvelId;
    // les médias encodés suivent le dossier
    for (const media of Object.keys(projet.sortie) as Media[]) {
      const s = projet.sortie[media];
      if (s && s.fichier === chemins(id).sortieMedia(media)) s.fichier = chemins(nouvelId).sortieMedia(media);
    }
    await ecrireAtomique(chemins(nouvelId).projet, JSON.stringify(projet, null, 2));
    cache.set(nouvelId, structuredClone(projet));
    diffuser({ type: "projets", donnees: null });
  });
}
