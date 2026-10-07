// Le workflow du Studio (fiche 7.4) : création d'un projet, préparation de la source, découpe,
// séparation, transcription, encodage, et reprise d'un extrait publié (fiche 7.6).

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.ts";
import {
  calculerPics,
  encoderPisteAudio,
  encoderVideo,
  encoderVignette,
  extraireMix,
  genererApercu,
  lisibleParNavigateur,
  mesurerLoudness,
  sonderSource,
} from "./ffmpeg.ts";
import { chercherParEmpreinte, empreinteFichier } from "./fichiers.ts";
import {
  chemins,
  enregistrerNouveauProjet,
  ErreurHttp,
  lireProjet,
  modifierProjet,
  projetExiste,
} from "./projets.ts";
import { separer, transcrire } from "./python.ts";
import { lancerTache, tacheActive, type ContexteTache } from "./taches.ts";
import {
  DEBITS_BED_POSSIBLES,
  DEBITS_VOICE_POSSIBLES,
  debutsRepliques,
  etatMedia,
  gainPourLoudness,
  HAUTEURS_POSSIBLES,
  recette,
  REGLAGES_ENCODAGE_DEFAUT,
} from "../commun/encodage.ts";
import { identifiantDepuisFichier, identifiantLibre, identifiantValide, versIdentifiant } from "../commun/identifiants.ts";
import { libelleModele } from "../commun/modeles.ts";
import { decalerRepliques } from "../commun/repliques.ts";
import { caleSurImage } from "../commun/temps.ts";
import {
  FICHIERS_MEDIAS,
  MEDIAS,
  type ChoixPiste,
  type Decoupe,
  type FabricationJson,
  type InfoJson,
  type Media,
  type ModificationProjet,
  type Projet,
  type RepliquesJson,
  type SourcesLecture,
  type Tache,
} from "../commun/types.ts";

const DUREE_MIN_EXTRAIT_MS = 500;
const DUREE_MAX_EXTRAIT_MS = 300_000;

/** Codes de langue ffprobe (ISO 639-2) vers ceux des extraits (ISO 639-1). */
const LANGUES: Record<string, string> = {
  fre: "fr", fra: "fr", eng: "en", spa: "es", ger: "de", deu: "de", ita: "it", jpn: "ja", por: "pt", kor: "ko", chi: "zh", zho: "zh",
};

export function dossierExtraitPublie(id: string): string {
  return join(config.dossierExtraits, "extraits", id);
}

async function verifierSource(projet: Projet): Promise<void> {
  if (!projet.source.chemin || !existsSync(projet.source.chemin)) {
    throw new Error(
      `Vidéo source introuvable${projet.source.chemin ? ` (${projet.source.chemin})` : ""}. Relie-la depuis l'étape Import.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Étape 1 : import
// ---------------------------------------------------------------------------

/** Identifiants déjà pris : projets de l'espace de travail et extraits publiés. */
export async function identifiantsPris(sauf?: string): Promise<Set<string>> {
  const pris = new Set<string>();
  for (const dossier of [config.dossierEspace, join(config.dossierExtraits, "extraits")]) {
    for (const nom of await readdir(dossier).catch(() => [] as string[])) if (nom !== sauf) pris.add(nom);
  }
  return pris;
}

/** L'identifiant d'un extrait est son titre mis en forme (« La proue ! » → « la-proue »). */
export async function identifiantPourTitre(titre: string, nomFichier: string, sauf?: string): Promise<string> {
  const base = versIdentifiant(titre) || identifiantDepuisFichier(nomFichier);
  return identifiantLibre(base, await identifiantsPris(sauf));
}

export async function creerProjet(chemin: string, titre: string): Promise<Projet> {
  titre = titre.trim();
  if (!titre) throw new ErreurHttp(400, "Donne un titre à l'extrait.");
  const id = await identifiantPourTitre(titre, chemin.split(/[\\/]/).pop() ?? "");
  let taille: number;
  try {
    const s = await stat(chemin);
    if (!s.isFile()) throw new Error();
    taille = s.size;
  } catch {
    throw new ErreurHttp(400, `Fichier introuvable : ${chemin}`);
  }
  const sonde = await sonderSource(chemin).catch((e: Error) => {
    throw new ErreurHttp(400, `Vidéo illisible par ffprobe : ${e.message}`);
  });
  const maintenant = new Date().toISOString();
  const langue = LANGUES[sonde.pistes_audio[0]?.langue ?? ""] ?? "fr";
  const projet: Projet = {
    id,
    cree_le: maintenant,
    modifie_le: maintenant,
    publication: null,
    source: { chemin, nom: chemin.split(/[\\/]/).pop()!, taille_octets: taille, empreinte: null, ...sonde },
    piste_audio: 0,
    apercu_piste: null,
    pics_piste: null,
    decoupe: null,
    mix: null,
    gain_db: null,
    separations: [],
    imports: [],
    voice: null,
    bed: null,
    personnages: [],
    repliques: [],
    prochain_id_replique: 1,
    infos: { titre, categorie: "", tags: [], langue, vignette_ms: 0 },
    encodage: { ...REGLAGES_ENCODAGE_DEFAUT },
    sortie: {},
    transcription: null,
  };
  await enregistrerNouveauProjet(projet);
  preparerSource(projet);
  return projet;
}

/** Lance ce qui manque pour travailler sur la source : empreinte, forme d'onde, aperçu. */
export function preparerSource(projet: Projet): void {
  const { id } = projet;
  if (!projet.source.chemin || !existsSync(projet.source.chemin)) return;

  if (!projet.source.empreinte && !tacheActive(id, "empreinte")) {
    lancerTache({ projet: id, type: "empreinte", libelle: "Empreinte de la source" }, async (ctx) => {
      const chemin = projet.source.chemin;
      const empreinte = await empreinteFichier(chemin, ctx);
      await modifierProjet(id, (p) => {
        if (p.source.chemin === chemin) p.source.empreinte = empreinte;
      });
    });
  }

  const rang = projet.piste_audio;
  if (projet.source.pistes_audio.length > 0 && projet.pics_piste !== rang && !tacheActive(id, "pics")) {
    lancerTache({ projet: id, type: "pics", libelle: "Forme d'onde de la source" }, async (ctx) => {
      const p = await lireProjet(id);
      await modifierProjet(id, (q) => void (q.pics_piste = null));
      await calculerPics(p.source, p.piste_audio, chemins(id).pics, ctx);
      await modifierProjet(id, (q) => void (q.pics_piste = p.piste_audio));
    });
  }

  if (!lisibleParNavigateur(projet.source, rang) && projet.apercu_piste !== rang && !tacheActive(id, "apercu")) {
    lancerTache({ projet: id, type: "apercu", libelle: "Aperçu vidéo pour la découpe", lourde: true }, async (ctx) => {
      const p = await lireProjet(id);
      await modifierProjet(id, (q) => void (q.apercu_piste = null));
      await genererApercu(p.source, p.piste_audio, chemins(id).apercu, ctx);
      await modifierProjet(id, (q) => void (q.apercu_piste = p.piste_audio));
    });
  }
}

/** La source a été déplacée : on la cherche dans les dossiers sources, par taille puis empreinte. */
export function lancerRechercheSource(id: string): Tache {
  return lancerTache({ projet: id, type: "recherche_source", libelle: "Recherche de la vidéo source" }, async (ctx) => {
    const p = await lireProjet(id);
    if (!p.source.empreinte) throw new Error("Empreinte de la source inconnue.");
    const trouve = await chercherParEmpreinte(p.source.empreinte, p.source.taille_octets, ctx);
    if (!trouve) throw new Error("Source introuvable (dossiers sources des Réglages, Téléchargements, Vidéos, Bureau, Documents).");
    await relierSource(id, trouve, ctx, false);
  });
}

/** Relie le projet à un fichier source (choisi à la main ou retrouvé), après vérification. */
export async function relierSource(id: string, chemin: string, ctx?: ContexteTache, verifier = true): Promise<void> {
  const p = await lireProjet(id);
  const { size } = await stat(chemin);
  if (p.source.empreinte) {
    if (size !== p.source.taille_octets && p.source.taille_octets > 0) {
      throw new ErreurHttp(400, "Ce fichier n'a pas la taille de la source d'origine.");
    }
    if (verifier && (await empreinteFichier(chemin, { signal: ctx?.signal, progression: ctx?.progression })) !== p.source.empreinte) {
      throw new ErreurHttp(400, "Ce fichier n'est pas la source d'origine (empreinte différente).");
    }
  }
  const sonde = await sonderSource(chemin);
  const projet = await modifierProjet(id, (q) => {
    const indexAttendu = q.source.index_piste_publiee;
    q.source = { ...q.source, ...sonde, chemin, nom: chemin.split(/[\\/]/).pop()!, taille_octets: size };
    if (indexAttendu !== undefined) {
      q.piste_audio = Math.max(0, sonde.pistes_audio.findIndex((s) => s.index === indexAttendu));
      delete q.source.index_piste_publiee;
    }
  });
  preparerSource(projet);
}

// ---------------------------------------------------------------------------
// Modifications depuis l'interface (découpe, choix des pistes, répliques, infos…)
// ---------------------------------------------------------------------------

/** Fin de la piste vidéo (temps du Studio) : l'audio peut durer un peu plus, pas l'extrait. */
export function finVideo(source: Projet["source"]): number {
  const { duree_ms, decalage_ms } = source.video;
  return duree_ms ? Math.min(source.duree_ms, decalage_ms + duree_ms) : source.duree_ms;
}

export function separationPerimee(p: Projet, sid: string): boolean {
  const s = p.separations.find((x) => x.id === sid);
  if (!s || !p.decoupe) return true;
  return s.piste_audio !== p.piste_audio || s.decoupe.entree_ms !== p.decoupe.entree_ms || s.decoupe.sortie_ms !== p.decoupe.sortie_ms;
}

export function mixAJour(p: Projet): boolean {
  return (
    !!p.mix &&
    !!p.decoupe &&
    p.mix.piste_audio === p.piste_audio &&
    p.mix.decoupe.entree_ms === p.decoupe.entree_ms &&
    p.mix.decoupe.sortie_ms === p.decoupe.sortie_ms &&
    existsSync(chemins(p.id).mix)
  );
}

export function importPerime(p: Projet, iid: string): boolean {
  const i = p.imports.find((x) => x.id === iid);
  return !i || !p.decoupe || i.decoupe.entree_ms !== p.decoupe.entree_ms || i.decoupe.sortie_ms !== p.decoupe.sortie_ms;
}

/** Nouvelle plage ou nouvelle piste audio : le mix, le gain et les pistes choisies ne valent plus. */
function invaliderAudio(p: Projet): void {
  p.gain_db = null;
  for (const quoi of ["voice", "bed"] as const) {
    const choix = p[quoi];
    if (
      choix?.origine === "publie" ||
      (choix?.origine === "separation" && separationPerimee(p, choix.separation)) ||
      (choix?.origine === "import" && importPerime(p, choix.import))
    ) {
      p[quoi] = null;
    }
  }
}

function verifierChoix(p: Projet, choix: ChoixPiste | null): void {
  if (!choix) return;
  if (choix.origine === "separation" && separationPerimee(p, choix.separation)) {
    throw new ErreurHttp(400, "Cette séparation n'existe pas ou ne correspond plus à la découpe.");
  }
  if (choix.origine === "import" && importPerime(p, choix.import)) {
    throw new ErreurHttp(400, "Cette piste importée n'existe pas ou ne correspond plus à la découpe.");
  }
}

export async function appliquerModification(id: string, m: ModificationProjet): Promise<Projet> {
  let sourceAPreparer = false;
  const projet = await modifierProjet(id, (p) => {
    if (m.piste_audio !== undefined && m.piste_audio !== p.piste_audio) {
      if (!p.source.pistes_audio[m.piste_audio]) throw new ErreurHttp(400, "Piste audio inconnue.");
      p.piste_audio = m.piste_audio;
      invaliderAudio(p);
      sourceAPreparer = true;
    }

    if (m.decoupe) {
      const { ips, decalage_ms } = p.source.video;
      const fin = finVideo(p.source);
      const d: Decoupe = {
        entree_ms: caleSurImage(Math.max(0, m.decoupe.entree_ms), ips, decalage_ms),
        sortie_ms: caleSurImage(Math.min(fin, m.decoupe.sortie_ms), ips, decalage_ms),
      };
      const duree = d.sortie_ms - d.entree_ms;
      if (duree < DUREE_MIN_EXTRAIT_MS) throw new ErreurHttp(400, "Extrait trop court (0,5 s minimum).");
      if (duree > DUREE_MAX_EXTRAIT_MS) throw new ErreurHttp(400, "Extrait trop long (5 min maximum, 60 s conseillé).");
      const ancienne = p.decoupe;
      if (!ancienne || ancienne.entree_ms !== d.entree_ms || ancienne.sortie_ms !== d.sortie_ms) {
        if (ancienne) p.repliques = decalerRepliques(p.repliques, ancienne, d).repliques;
        p.decoupe = d;
        invaliderAudio(p);
        if (ancienne) p.infos.vignette_ms += ancienne.entree_ms - d.entree_ms;
        p.infos.vignette_ms = Math.min(Math.max(0, p.infos.vignette_ms), duree - 1);
      }
    }

    if (m.voice !== undefined) {
      verifierChoix(p, m.voice);
      p.voice = m.voice;
    }
    if (m.bed !== undefined) {
      verifierChoix(p, m.bed);
      p.bed = m.bed;
    }

    if (m.personnages) {
      const ids = new Set<string>();
      for (const perso of m.personnages) {
        if (!identifiantValide(perso.id)) throw new ErreurHttp(400, `Identifiant de personnage invalide : « ${perso.id} ».`);
        if (ids.has(perso.id)) throw new ErreurHttp(400, `Personnage en double : « ${perso.id} ».`);
        ids.add(perso.id);
      }
      p.personnages = m.personnages.map((x) => ({ id: x.id, nom: x.nom }));
    }

    if (m.repliques) {
      const ids = new Set<number>();
      for (const r of m.repliques) {
        if (!Number.isInteger(r.id) || r.id < 1 || ids.has(r.id)) throw new ErreurHttp(400, `Id de réplique invalide : ${r.id}.`);
        ids.add(r.id);
      }
      p.repliques = m.repliques.map((r) => ({
        id: r.id,
        personnage: r.personnage,
        debut_ms: Math.round(r.debut_ms),
        fin_ms: Math.round(r.fin_ms),
        texte: r.texte,
      }));
      const max = Math.max(0, ...ids);
      p.prochain_id_replique = Math.max(p.prochain_id_replique, max + 1);
    }
    if (m.prochain_id_replique !== undefined) {
      p.prochain_id_replique = Math.max(p.prochain_id_replique, m.prochain_id_replique);
    }

    if (m.infos) {
      const duree = p.decoupe ? p.decoupe.sortie_ms - p.decoupe.entree_ms : Infinity;
      p.infos = {
        titre: m.infos.titre,
        categorie: m.infos.categorie,
        tags: m.infos.tags,
        langue: m.infos.langue,
        vignette_ms: Math.round(Math.min(Math.max(0, m.infos.vignette_ms), duree - 1)),
      };
    }

    if (m.encodage) {
      const { hauteur, crf, debit_max, voice_kbps, bed_kbps } = m.encodage;
      if (!HAUTEURS_POSSIBLES.includes(hauteur)) throw new ErreurHttp(400, "Hauteur non prévue.");
      if (!Number.isInteger(crf) || crf < 16 || crf > 36) throw new ErreurHttp(400, "CRF entre 16 et 36.");
      if (!/^\d+(\.\d+)?[kM]$/.test(debit_max)) throw new ErreurHttp(400, "Débit maximal invalide (ex. 2M).");
      if (!DEBITS_VOICE_POSSIBLES.includes(voice_kbps)) throw new ErreurHttp(400, "Débit de la voice non prévu.");
      if (!DEBITS_BED_POSSIBLES.includes(bed_kbps)) throw new ErreurHttp(400, "Débit du bed non prévu.");
      p.encodage = { hauteur, crf, debit_max, voice_kbps, bed_kbps };
    }
  });
  if (sourceAPreparer) preparerSource(projet);
  return projet;
}

// ---------------------------------------------------------------------------
// Étape 3 : voix et fond
// ---------------------------------------------------------------------------

/** Extrait l'audio original de la plage et mesure son volume, si ce n'est pas déjà fait. */
export async function preparerMix(id: string, ctx: ContexteTache): Promise<Projet> {
  const p = await lireProjet(id);
  if (!p.decoupe) throw new Error("Fais d'abord la découpe (étape 2).");
  if (mixAJour(p)) return p;
  await verifierSource(p);
  const decoupe = p.decoupe;
  const piste = p.piste_audio;
  const c = chemins(id);
  ctx.progression(0, "Extraction de l'audio de la plage");
  await extraireMix(p.source, piste, decoupe, c.mix, { signal: ctx.signal, progression: (v) => ctx.progression((v ?? 0) * 0.5) });
  ctx.progression(0.6, "Mesure du volume");
  const lufs = await mesurerLoudness(c.mix, { signal: ctx.signal });
  const perimees: string[] = [];
  const importsPerimes: string[] = [];
  const projet = await modifierProjet(id, (q) => {
    q.mix = { decoupe, piste_audio: piste, loudness_lufs: lufs };
    q.gain_db = gainPourLoudness(lufs);
    // les séparations d'une autre plage ne servent plus
    for (const s of q.separations) if (separationPerimee(q, s.id)) perimees.push(s.id);
    q.separations = q.separations.filter((s) => !perimees.includes(s.id));
    for (const i of q.imports) if (importPerime(q, i.id)) importsPerimes.push(i.id);
    q.imports = q.imports.filter((i) => !importsPerimes.includes(i.id));
    for (const quoi of ["voice", "bed"] as const) {
      const choix = q[quoi];
      if (choix?.origine === "separation" && perimees.includes(choix.separation)) q[quoi] = null;
      if (choix?.origine === "import" && importsPerimes.includes(choix.import)) q[quoi] = null;
    }
  });
  for (const sid of perimees) await rm(c.separation(sid), { recursive: true, force: true });
  for (const iid of importsPerimes) await rm(c.importWav(iid), { force: true });
  return projet;
}

export function lancerSeparation(id: string, modele: string): Tache {
  return lancerTache(
    { projet: id, type: "separation", libelle: `Séparation : ${libelleModele(modele)}`, lourde: true },
    async (ctx) => {
      await preparerMix(id, ctx);
      const p = await lireProjet(id);
      const base = versIdentifiant(modele.replace(/\.[^.]+$/, "")).slice(0, 40) || "separation";
      let n = 1;
      while (p.separations.some((s) => s.id === `${base}-${n}`) || existsSync(chemins(id).separation(`${base}-${n}`))) n++;
      const sid = `${base}-${n}`;
      const dossier = chemins(id).separation(sid);
      const temporaire = `${dossier}.partiel`;
      await rm(temporaire, { recursive: true, force: true });
      await mkdir(temporaire, { recursive: true });
      try {
        await separer(chemins(id).mix, modele, temporaire, ctx);
        await rename(temporaire, dossier);
      } catch (e) {
        await rm(temporaire, { recursive: true, force: true });
        throw e;
      }
      await modifierProjet(id, (q) => {
        q.separations.push({
          id: sid,
          moteur: "audio-separator",
          modele,
          libelle: libelleModele(modele),
          decoupe: { ...p.decoupe! },
          piste_audio: p.piste_audio,
          cree_le: new Date().toISOString(),
        });
        // première séparation : choisie d'office pour la voice et le bed
        if (!q.voice) q.voice = { origine: "separation", separation: sid };
        if (!q.bed) q.bed = { origine: "separation", separation: sid };
      });
    },
  );
}

export async function supprimerSeparation(id: string, sid: string): Promise<Projet> {
  const projet = await modifierProjet(id, (p) => {
    p.separations = p.separations.filter((s) => s.id !== sid);
    for (const quoi of ["voice", "bed"] as const) {
      const choix = p[quoi];
      if (choix?.origine === "separation" && choix.separation === sid) p[quoi] = null;
    }
  });
  await rm(chemins(id).separation(sid), { recursive: true, force: true });
  return projet;
}

/** WAV de travail de la piste choisie, s'il existe dans l'espace de travail. */
export function wavPiste(p: Projet, quoi: "voice" | "bed"): string | null {
  const choix = p[quoi];
  if (choix?.origine === "separation") {
    const chemin = join(chemins(p.id).separation(choix.separation), `${quoi}.wav`);
    return existsSync(chemin) ? chemin : null;
  }
  if (choix?.origine === "import") {
    const chemin = chemins(p.id).importWav(choix.import);
    return existsSync(chemin) ? chemin : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Étape 4 : transcription
// ---------------------------------------------------------------------------

export function lancerTranscription(id: string): Tache {
  return lancerTache({ projet: id, type: "transcription", libelle: "Transcription (Whisper)", lourde: true }, async (ctx) => {
    const p = await lireProjet(id);
    const wav = wavPiste(p, "voice");
    if (!wav) throw new Error("Il faut une voice séparée (étape 3) pour transcrire.");
    const sortie = chemins(id).transcription;
    await transcrire(wav, p.infos.langue || null, sortie, ctx);
    const { modele, langue } = JSON.parse(await readFile(sortie, "utf8")) as { modele: string; langue: string };
    await modifierProjet(id, (q) => void (q.transcription = { modele, langue, le: new Date().toISOString() }));
  });
}

// ---------------------------------------------------------------------------
// Étape 6 : encodage
// ---------------------------------------------------------------------------

/** Médias à encoder : manquants ou à refaire, plus la vidéo si on veut recaler ses images clés. */
export function mediasAEncoder(p: Projet, recalerImagesCles: boolean): Media[] {
  return MEDIAS.filter((m) => {
    const e = etatMedia(m, p).etat;
    return e === "manquant" || e === "a_refaire" || (e === "images_cles" && recalerImagesCles);
  });
}

export function lancerEncodage(id: string, recalerImagesCles: boolean): Tache {
  return lancerTache({ projet: id, type: "encodage", libelle: "Encodage", lourde: true }, async (ctx) => {
    const p = await lireProjet(id);
    const bloques = MEDIAS.map((m) => etatMedia(m, p)).filter((e) => e.etat === "bloque");
    if (bloques.length > 0) throw new Error(bloques.map((e) => ("raison" in e ? e.raison : "")).join(" "));
    const aFaire = mediasAEncoder(p, recalerImagesCles);
    if (aFaire.length === 0) return;
    if (aFaire.includes("video") || aFaire.includes("vignette")) await verifierSource(p);

    const decoupe = p.decoupe!;
    const duree = decoupe.sortie_ms - decoupe.entree_ms;
    const poids: Record<Media, number> = { video: 8, voice: 1, bed: 1, vignette: 0.3 };
    const total = aFaire.reduce((s, m) => s + poids[m], 0);
    let fait = 0;
    await mkdir(chemins(id).sortie, { recursive: true });

    for (const media of aFaire) {
      const dest = chemins(id).sortieMedia(media);
      const suivi = {
        signal: ctx.signal,
        progression: (v: number | null) => ctx.progression((fait + (v ?? 0) * poids[media]) / total, `${FICHIERS_MEDIAS[media]}`),
      };
      suivi.progression(0);
      const debuts = debutsRepliques(p.repliques, duree);
      if (media === "video") {
        await encoderVideo(p.source, decoupe, p.encodage, debuts, dest, suivi);
      } else if (media === "vignette") {
        await encoderVignette(p.source, decoupe.entree_ms + p.infos.vignette_ms, dest, suivi);
      } else {
        const wav = wavPiste(p, media);
        if (!wav) throw new Error(`Pas de WAV de travail pour la ${media} : relance une séparation (étape 3).`);
        const kbps = media === "voice" ? p.encodage.voice_kbps : p.encodage.bed_kbps;
        await encoderPisteAudio(wav, media, p.gain_db!, kbps, duree, dest, suivi);
      }
      const { size } = await stat(dest);
      const empreinte = await empreinteFichier(dest);
      await modifierProjet(id, (q) => {
        q.sortie[media] = {
          fichier: dest,
          recette: recette(media, p)!,
          taille_octets: size,
          empreinte,
          encode_le: new Date().toISOString(),
          ...(media === "video" ? { images_cles: debuts } : {}),
        };
      });
      fait += poids[media];
    }
  });
}

// ---------------------------------------------------------------------------
// Lecture dans l'interface
// ---------------------------------------------------------------------------

export function sourcesLecture(p: Projet): SourcesLecture {
  const base = `/api/projets/${encodeURIComponent(p.id)}/media`;
  const v = (n: number | string) => `?v=${encodeURIComponent(String(n))}`;
  const lecture: SourcesLecture = { video: null, mix: null, voice: null, bed: null, raison_video: null };
  const sourcePresente = !!p.source.chemin && existsSync(p.source.chemin);

  if (sourcePresente && lisibleParNavigateur(p.source, p.piste_audio)) {
    lecture.video = { url: `${base}/source${v(p.source.taille_octets)}`, decalage_ms: p.decoupe?.entree_ms ?? 0 };
  } else if (p.apercu_piste === p.piste_audio && existsSync(chemins(p.id).apercu)) {
    lecture.video = { url: `${base}/apercu${v(`${p.apercu_piste}-${p.source.taille_octets}`)}`, decalage_ms: p.decoupe?.entree_ms ?? 0 };
  } else if (p.sortie.video && existsSync(p.sortie.video.fichier) && etatMedia("video", p).etat !== "a_refaire") {
    lecture.video = { url: `${base}/sortie-video${v(p.sortie.video.empreinte)}`, decalage_ms: 0 };
  } else {
    lecture.raison_video = sourcePresente ? "Aperçu vidéo en préparation…" : "Vidéo source introuvable.";
  }

  if (mixAJour(p)) lecture.mix = `${base}/mix${v(`${p.mix!.decoupe.entree_ms}-${p.mix!.decoupe.sortie_ms}-${p.mix!.piste_audio}`)}`;
  for (const quoi of ["voice", "bed"] as const) {
    const choix = p[quoi];
    if (wavPiste(p, quoi) && choix?.origine === "separation") lecture[quoi] = `${base}/${quoi}${v(choix.separation)}`;
    else if (wavPiste(p, quoi) && choix?.origine === "import") lecture[quoi] = `${base}/${quoi}${v(choix.import)}`;
    else if (p.sortie[quoi] && existsSync(p.sortie[quoi]!.fichier)) lecture[quoi] = `${base}/sortie-${quoi}${v(p.sortie[quoi]!.empreinte)}`;
  }
  return lecture;
}

// ---------------------------------------------------------------------------
// Reprise d'un extrait publié sans projet (fiche 7.6)
// ---------------------------------------------------------------------------

export async function ouvrirExtraitPublie(id: string): Promise<Projet> {
  if (projetExiste(id)) return lireProjet(id);
  const dossier = dossierExtraitPublie(id);
  const lire = async <T>(nom: string) => JSON.parse(await readFile(join(dossier, nom), "utf8")) as T;
  let info: InfoJson, repliques: RepliquesJson, fab: FabricationJson;
  try {
    [info, repliques, fab] = await Promise.all([
      lire<InfoJson>("info.json"),
      lire<RepliquesJson>("repliques.json"),
      lire<FabricationJson>("fabrication.json"),
    ]);
  } catch {
    throw new ErreurHttp(404, `Extrait publié « ${id} » introuvable ou incomplet.`);
  }
  const maintenant = new Date().toISOString();
  const projet: Projet = {
    id,
    cree_le: maintenant,
    modifie_le: maintenant,
    publication: { version_medias: info.version_medias, le: maintenant, commit: null },
    source: {
      chemin: "",
      nom: fab.source.nom,
      taille_octets: fab.source.taille_octets ?? 0,
      empreinte: fab.source.empreinte,
      duree_ms: fab.source.duree_ms,
      debut_ms: 0,
      conteneur: "",
      video: { codec: "?", largeur: 0, hauteur: 0, ips: fab.encodage.ips ?? 25, decalage_ms: 0, format_pixels: "?", entrelacee: false },
      pistes_audio: [],
      ...(fab.source.piste_audio !== undefined ? { index_piste_publiee: fab.source.piste_audio } : {}),
    },
    piste_audio: 0,
    apercu_piste: null,
    pics_piste: null,
    decoupe: { ...fab.decoupe },
    mix: null,
    gain_db: fab.gain_db,
    separations: [],
    imports: [],
    voice: { origine: "publie", piste: fab.voice },
    bed: { origine: "publie", piste: fab.bed },
    personnages: info.personnages,
    repliques: repliques.repliques,
    prochain_id_replique: Math.max(0, ...repliques.repliques.map((r) => r.id)) + 1,
    infos: {
      titre: info.titre,
      categorie: info.categorie,
      tags: info.tags,
      langue: info.langue,
      vignette_ms: fab.vignette_ms,
    },
    encodage: {
      hauteur: fab.encodage.hauteur,
      crf: fab.encodage.crf,
      debit_max: fab.encodage.debit_max,
      // fabrication.json d'avant le réglage des débits audio
      voice_kbps: fab.encodage.voice_kbps ?? REGLAGES_ENCODAGE_DEFAUT.voice_kbps,
      bed_kbps: fab.encodage.bed_kbps ?? REGLAGES_ENCODAGE_DEFAUT.bed_kbps,
    },
    sortie: {},
    transcription: null,
  };
  // les médias publiés sont à jour par définition : leur recette est celle du projet reconstitué
  const duree = fab.decoupe.sortie_ms - fab.decoupe.entree_ms;
  for (const media of MEDIAS) {
    const fichier = join(dossier, "medias", info.fichiers[media]);
    if (!existsSync(fichier)) continue;
    projet.sortie[media] = {
      fichier,
      recette: recette(media, projet)!,
      taille_octets: (await stat(fichier)).size,
      empreinte: await empreinteFichier(fichier),
      encode_le: maintenant,
      ...(media === "video" ? { images_cles: debutsRepliques(projet.repliques, duree) } : {}),
    };
  }
  await enregistrerNouveauProjet(projet);
  lancerRechercheSource(id);
  return projet;
}
