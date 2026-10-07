// API du Studio, utilisée par l'interface (web/).

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.ts";
import { controler } from "./controle.ts";
import { abonner } from "./evenements.ts";
import { capturerImage, nvencDisponible, PICS_PAR_SECONDE } from "./ffmpeg.ts";
import { dialoguesDisponibles, ouvrirDialogue, type TypeDialogue } from "./dialogues.ts";
import { chercherParNomEtTaille, dossiersUtilisateur, ecrireReglages, listerDossier, lireReglages, televerser } from "./fichiers.ts";
import { envoyerFichier, Routeur } from "./http.ts";
import { executer } from "./processus.ts";
import { chemins, ErreurHttp, lireProjet, listerProjets, projetExiste, renommerProjet, supprimerProjet } from "./projets.ts";
import { apercuPublication, lancerPublication, lancerRetrait } from "./publication.ts";
import { exporterPiste, recevoirImport, supprimerImport, validerImport } from "./retouche.ts";
import { etatPython } from "./python.ts";
import { infosVideo, lancerTelechargement } from "./youtube.ts";
import { annulerTache, annulerTachesProjet, listerTaches, tachesActives } from "./taches.ts";
import {
  appliquerModification,
  creerProjet,
  identifiantPourTitre,
  dossierExtraitPublie,
  lancerEncodage,
  lancerRechercheSource,
  lancerSeparation,
  lancerTranscription,
  mediasAEncoder,
  ouvrirExtraitPublie,
  preparerSource,
  relierSource,
  sourcesLecture,
  supprimerSeparation,
  wavPiste,
} from "./travaux.ts";
import { etatMedia } from "../commun/encodage.ts";
import { MODELES_SEPARATION } from "../commun/modeles.ts";
import { CATEGORIES } from "../commun/publication.ts";
import { MEDIAS, type EtatOutils, type ExtraitPublie, type InfoJson, type Media, type ModificationProjet } from "../commun/types.ts";

export const routeur = new Routeur();

function texte(valeur: unknown, nom: string): string {
  if (typeof valeur !== "string" || !valeur.trim()) throw new ErreurHttp(400, `« ${nom} » manquant.`);
  return valeur.trim();
}

function sansTacheEnCours(id: string): void {
  if (tachesActives(id).length > 0) throw new ErreurHttp(409, "Une tâche est en cours sur ce projet : attends sa fin ou annule-la.");
}

// ---------------------------------------------------------------------------
// Général
// ---------------------------------------------------------------------------

let outils: Promise<EtatOutils> | null = null;

async function detecterOutils(): Promise<EtatOutils> {
  const version = async (commande: string, args: string[], motif: RegExp) => {
    try {
      const { stdout } = await executer(commande, args);
      return motif.exec(stdout)?.[1] ?? stdout.split(/\r?\n/)[0];
    } catch {
      return null;
    }
  };
  const [ffmpeg, git, python, nvenc] = await Promise.all([
    version(config.ffmpeg, ["-hide_banner", "-version"], /ffmpeg version (\S+)/),
    version(config.git, ["--version"], /git version (\S+)/),
    etatPython(),
    nvencDisponible(),
  ]);
  return {
    ffmpeg,
    nvenc,
    git,
    python: python.python,
    audio_separator: python.audio_separator,
    faster_whisper: python.faster_whisper,
    yt_dlp: python.yt_dlp,
    cuda: python.cuda,
  };
}

routeur.get("/api/evenements", ({ res }) => abonner(res));

routeur.get("/api/etat", async ({ query }) => {
  if (query.has("rafraichir") || !outils) outils = detecterOutils();
  return {
    outils: await outils,
    dossiers: { extraits: config.dossierExtraits, espace: config.dossierEspace, modeles: config.dossierModeles },
    url_extraits: config.urlExtraits,
    extraits_present: existsSync(join(config.dossierExtraits, "schema")),
    dialogues_natifs: dialoguesDisponibles,
    dossiers_utilisateur: await dossiersUtilisateur(),
    modeles_separation: MODELES_SEPARATION,
    taches: listerTaches(),
  };
});

routeur.get("/api/reglages", () => lireReglages());
routeur.put("/api/reglages", async ({ corps }) => {
  const r = (await corps()) as { dossiers_sources?: unknown };
  if (!Array.isArray(r.dossiers_sources) || !r.dossiers_sources.every((d) => typeof d === "string")) {
    throw new ErreurHttp(400, "dossiers_sources : liste de chemins attendue.");
  }
  return ecrireReglages({ dossiers_sources: r.dossiers_sources as string[] });
});

routeur.get("/api/fichiers", async ({ query }) => {
  try {
    return await listerDossier(query.get("dossier") ?? undefined);
  } catch {
    throw new ErreurHttp(404, "Dossier inaccessible.");
  }
});

routeur.post("/api/fichiers/chercher", async ({ corps }) => {
  const { nom, taille } = (await corps()) as { nom?: string; taille?: number };
  return { chemins: await chercherParNomEtTaille(texte(nom, "nom"), Number(taille)) };
});

routeur.post("/api/dialogue", async ({ corps }) => {
  const { type, titre } = (await corps()) as { type?: TypeDialogue; titre?: string };
  if (!type || !["video", "audio", "dossier"].includes(type)) throw new ErreurHttp(400, "Type de fenêtre inconnu.");
  return { chemin: await ouvrirDialogue(type, titre ?? "Choisir") };
});

/** Copie d'une vidéo glissée qu'on ne retrouve pas sur le disque (corps binaire). */
routeur.post("/api/televersement", async ({ req, query }) => {
  // en-tête personnalisé : une page web tierce ne peut pas l'envoyer sans autorisation du Studio
  if (req.headers["x-studio"] !== "1") throw new ErreurHttp(403, "Requête refusée.");
  const nom = texte(query.get("nom"), "nom");
  const taille = Number(query.get("taille"));
  if (!Number.isFinite(taille) || taille <= 0) throw new ErreurHttp(400, "Taille invalide.");
  return { chemin: await televerser(nom, taille, req) };
});

/** Vidéo en ligne (YouTube…) : infos, puis téléchargement dans _sources/ (tâche de fond). */
routeur.post("/api/en-ligne/infos", async ({ corps }) => {
  const { adresse } = (await corps()) as { adresse?: string };
  return infosVideo(texte(adresse, "adresse"));
});

routeur.post("/api/en-ligne/telecharger", async ({ corps }) => {
  const { adresse, id, titre, passage } = (await corps()) as {
    adresse?: string;
    id?: string;
    titre?: string;
    passage?: { debut_ms: number; fin_ms: number } | null;
  };
  return lancerTelechargement({ adresse: texte(adresse, "adresse"), id, titre, passage });
});

routeur.get("/api/taches", () => listerTaches());
routeur.post("/api/taches/:id/annuler", ({ params }) => ({ ok: annulerTache(params.id) }));

// ---------------------------------------------------------------------------
// Bibliothèque
// ---------------------------------------------------------------------------

async function extraitsPublies(): Promise<ExtraitPublie[]> {
  const racine = join(config.dossierExtraits, "extraits");
  if (!existsSync(racine)) return [];
  const liste: ExtraitPublie[] = [];
  for (const e of await readdir(racine, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    try {
      const info = JSON.parse(await readFile(join(racine, e.name, "info.json"), "utf8")) as InfoJson;
      liste.push({ id: info.id, titre: info.titre, version_medias: info.version_medias, duree_ms: info.duree_ms, projet: projetExiste(e.name) });
    } catch {
      // dossier incomplet : ignoré
    }
  }
  return liste.sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
}

routeur.get("/api/bibliotheque", async () => ({ projets: await listerProjets(), publies: await extraitsPublies() }));

/** Catégories et tags déjà utilisés, pour les proposer à la saisie. */
routeur.get("/api/vocabulaire", async () => {
  const categories = new Set<string>(CATEGORIES);
  const tags = new Set<string>();
  try {
    const catalogue = JSON.parse(await readFile(join(config.dossierExtraits, "catalogue.json"), "utf8")) as {
      extraits: { categorie: string; tags: string[] }[];
    };
    for (const e of catalogue.extraits) {
      categories.add(e.categorie);
      e.tags.forEach((t) => tags.add(t));
    }
  } catch {
    // pas de catalogue
  }
  return { categories: [...categories], tags: [...tags].sort() };
});

routeur.post("/api/identifiant", async ({ corps }) => {
  const { titre, nom } = (await corps()) as { titre?: string; nom?: string };
  return { id: await identifiantPourTitre(titre ?? "", nom ?? "extrait") };
});

// ---------------------------------------------------------------------------
// Projets
// ---------------------------------------------------------------------------

routeur.post("/api/projets", async ({ corps }) => {
  const { chemin, titre } = (await corps()) as { chemin?: string; titre?: string };
  return creerProjet(texte(chemin, "chemin").replace(/^"|"$/g, ""), texte(titre, "titre"));
});

routeur.post("/api/publies/:id/ouvrir", ({ params }) => ouvrirExtraitPublie(params.id));

/** Retirer un extrait du jeu (dépôt des extraits, catalogue, commit et push). */
routeur.post("/api/publies/:id/retirer", async ({ params, corps }) => {
  const { pousser } = (await corps()) as { pousser?: boolean };
  return lancerRetrait(params.id, pousser !== false);
});

routeur.get("/api/projets/:id", async ({ params }) => {
  const projet = await lireProjet(params.id);
  return {
    projet,
    lecture: sourcesLecture(projet),
    source_presente: !!projet.source.chemin && existsSync(projet.source.chemin),
    etats_medias: Object.fromEntries(MEDIAS.map((m) => [m, etatMedia(m, projet)])),
    a_encoder: mediasAEncoder(projet, false),
    publie: existsSync(join(dossierExtraitPublie(projet.id), "info.json")),
    wav: { voice: !!wavPiste(projet, "voice"), bed: !!wavPiste(projet, "bed") },
  };
});

routeur.patch("/api/projets/:id", async ({ params, corps }) => {
  return appliquerModification(params.id, (await corps()) as ModificationProjet);
});

routeur.delete("/api/projets/:id", async ({ params }) => {
  annulerTachesProjet(params.id);
  await supprimerProjet(params.id);
});

/** Tant que l'extrait n'est pas publié, son identifiant suit son titre. */
routeur.post("/api/projets/:id/renommer", async ({ params, corps }) => {
  const { titre } = (await corps()) as { titre?: string };
  const p = await lireProjet(params.id);
  if (p.publication) return { id: p.id };
  const nouvelId = await identifiantPourTitre(texte(titre, "titre"), p.source.nom, p.id);
  if (nouvelId === p.id) return { id: p.id };
  sansTacheEnCours(params.id);
  await renommerProjet(params.id, nouvelId);
  return { id: nouvelId };
});

routeur.post("/api/projets/:id/source", async ({ params, corps }) => {
  const { chemin } = (await corps()) as { chemin?: string };
  if (chemin) await relierSource(params.id, texte(chemin, "chemin").replace(/^"|"$/g, ""));
  else return lancerRechercheSource(params.id);
});

routeur.post("/api/projets/:id/preparer", async ({ params }) => {
  preparerSource(await lireProjet(params.id));
});

// ---------------------------------------------------------------------------
// Médias de travail
// ---------------------------------------------------------------------------

routeur.get("/api/projets/:id/media/:quoi", async ({ req, res, params }) => {
  const p = await lireProjet(params.id);
  const c = chemins(p.id);
  const quoi = params.quoi;
  let fichier: string | null = null;
  if (quoi === "source") fichier = p.source.chemin;
  else if (quoi === "apercu") fichier = c.apercu;
  else if (quoi === "mix") fichier = c.mix;
  else if (quoi === "voice" || quoi === "bed") fichier = wavPiste(p, quoi);
  else if (quoi.startsWith("sortie-")) fichier = p.sortie[quoi.slice(7) as Media]?.fichier ?? null;
  else if (quoi.startsWith("import-")) {
    const iid = quoi.slice(7);
    if (p.imports.some((i) => i.id === iid)) fichier = c.importWav(iid);
  } else if (quoi.startsWith("separation-")) {
    // separation-<id>-voice / separation-<id>-bed
    const m = /^separation-(.+)-(voice|bed)$/.exec(quoi);
    if (m && p.separations.some((s) => s.id === m[1])) fichier = join(c.separation(m[1]), `${m[2]}.wav`);
  }
  if (!fichier) throw new ErreurHttp(404, "Média inconnu.");
  await envoyerFichier(req, res, fichier);
});

routeur.get("/api/projets/:id/pics", async ({ req, res, params }) => {
  const p = await lireProjet(params.id);
  if (p.pics_piste !== p.piste_audio) throw new ErreurHttp(409, "Forme d'onde en préparation.");
  res.setHeader("x-pics-par-seconde", String(PICS_PAR_SECONDE));
  await envoyerFichier(req, res, chemins(p.id).pics);
});

routeur.get("/api/projets/:id/transcription", async ({ params }) => {
  try {
    return JSON.parse(await readFile(chemins(params.id).transcription, "utf8"));
  } catch {
    throw new ErreurHttp(404, "Pas de transcription.");
  }
});

/** Image de la source à un instant (ms depuis le début de la source). */
routeur.get("/api/projets/:id/image", async ({ res, params, query }) => {
  const p = await lireProjet(params.id);
  if (!p.source.chemin || !existsSync(p.source.chemin)) throw new ErreurHttp(404, "Source introuvable.");
  const instant = Math.max(0, Math.min(Number(query.get("t") ?? 0), p.source.duree_ms - 1));
  const largeur = Math.min(1280, Math.max(64, Number(query.get("largeur") ?? 640)));
  const image = await capturerImage(p.source, instant, largeur);
  res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "private, max-age=3600", "content-length": image.length });
  res.end(image);
});

// ---------------------------------------------------------------------------
// Étapes 3 à 8
// ---------------------------------------------------------------------------

routeur.post("/api/projets/:id/separations", async ({ params, corps }) => {
  const { modeles } = (await corps()) as { modeles?: string[] };
  if (!Array.isArray(modeles) || modeles.length === 0) throw new ErreurHttp(400, "Choisis au moins un modèle.");
  const p = await lireProjet(params.id);
  if (!p.decoupe) throw new ErreurHttp(400, "Fais d'abord la découpe (étape 2).");
  return modeles.map((m) => lancerSeparation(params.id, texte(m, "modele")));
});

routeur.delete("/api/projets/:id/separations/:sid", async ({ params }) => {
  sansTacheEnCours(params.id);
  return supprimerSeparation(params.id, params.sid);
});

/** Copie d'une piste de l'étape 3 à retoucher dans un autre logiciel (téléchargement). */
routeur.get("/api/projets/:id/export/:piste", async ({ req, res, params }) => {
  const { chemin, nom } = await exporterPiste(params.id, params.piste);
  res.setHeader("content-disposition", `attachment; filename="${nom.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nom)}`);
  await envoyerFichier(req, res, chemin);
});

/** Piste retouchée ailleurs (corps binaire) : mesure et recherche du décalage, avant validation. */
routeur.post("/api/projets/:id/imports", async ({ req, params, query }) => {
  if (req.headers["x-studio"] !== "1") throw new ErreurHttp(403, "Requête refusée.");
  const quoi = query.get("quoi");
  if (quoi !== "voice" && quoi !== "bed") throw new ErreurHttp(400, "Préciser voice ou bed.");
  sansTacheEnCours(params.id);
  return recevoirImport(params.id, quoi, texte(query.get("nom"), "nom"), req);
});

routeur.post("/api/projets/:id/imports/:iid/valider", async ({ params, corps }) => {
  const { decalage_ms } = (await corps()) as { decalage_ms?: number };
  sansTacheEnCours(params.id);
  return validerImport(params.id, params.iid, Number(decalage_ms ?? 0));
});

routeur.delete("/api/projets/:id/imports/:iid", ({ params }) => supprimerImport(params.id, params.iid));

routeur.post("/api/projets/:id/transcription", ({ params }) => lancerTranscription(params.id));

routeur.post("/api/projets/:id/encoder", async ({ params, corps }) => {
  const { images_cles } = (await corps()) as { images_cles?: boolean };
  return lancerEncodage(params.id, !!images_cles);
});

routeur.get("/api/projets/:id/controle", async ({ params }) => {
  const p = await lireProjet(params.id);
  return controler(p, p.publication?.version_medias ?? 1);
});

routeur.get("/api/projets/:id/publication", ({ params }) => apercuPublication(params.id));

routeur.post("/api/projets/:id/publier", async ({ params, corps }) => {
  const { message, pousser } = (await corps()) as { message?: string; pousser?: boolean };
  sansTacheEnCours(params.id);
  return lancerPublication(params.id, texte(message, "message"), pousser !== false);
});

