// Téléchargement d'une vidéo YouTube (ou d'un autre site lu par yt-dlp) comme vidéo source.
// yt-dlp est installé dans studio/.venv ; le Node qui fait tourner le Studio lui sert de moteur
// JavaScript (YouTube l'exige pour donner ses formats). Les vidéos vont dans
// studio-workspace/_sources/, où le Studio cherche déjà les sources déplacées.

import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.ts";
import { dossierCopies } from "./fichiers.ts";
import { ErreurProcessus, executer } from "./processus.ts";
import { ErreurHttp } from "./projets.ts";
import { lancerTache } from "./taches.ts";
import type { InfosVideoEnLigne, Tache } from "../commun/types.ts";

const envPython = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };

/**
 * Format choisi : la meilleure définition jusqu'à 1080p (l'extrait sort en 720p au plus : au-delà,
 * on ne télécharge que du poids), en H.264 + AAC si YouTube le propose, rangés dans un MP4 que le
 * navigateur lit directement (pas d'aperçu à fabriquer). Sinon VP9 ou AV1, remis en MP4 sans
 * réencodage.
 */
const FORMAT = ["-S", "res:1080,vcodec:h264,acodec:aac", "--merge-output-format", "mp4", "--remux-video", "mp4"];

/** Avancement, une ligne par mise à jour : état | octets reçus | total | total estimé | codecs. */
const MODELE_AVANCEMENT =
  "download:@%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(info.vcodec)s|%(info.acodec)s";

function argumentsCommuns(): string[] {
  const args = ["-m", "yt_dlp", "--ignore-config", "--no-playlist", "--js-runtimes", `node:${process.execPath}`];
  if (/[\\/]/.test(config.ffmpeg)) args.push("--ffmpeg-location", config.ffmpeg);
  if (config.cookiesNavigateur) args.push("--cookies-from-browser", config.cookiesNavigateur);
  return args;
}

export function verifierAdresse(adresse: string): string {
  let url: URL;
  try {
    url = new URL(adresse.trim());
  } catch {
    throw new ErreurHttp(400, "Adresse invalide : colle l'adresse complète de la vidéo (https://…).");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ErreurHttp(400, "Adresse invalide : http ou https attendu.");
  return url.href;
}

/** Message lisible à partir d'un échec de yt-dlp, avec la piste la plus probable. */
function erreurYtDlp(e: unknown): Error {
  if (!(e instanceof ErreurProcessus)) return e instanceof Error ? e : new Error(String(e));
  if (e.code === null) return new Error("yt-dlp est introuvable : lance « npm run ytdlp:maj » dans le dossier du Studio.");
  const lignes = e.sortieErreur.split(/\r?\n/).filter((l) => l.startsWith("ERROR:"));
  const cause = lignes.length > 0 ? lignes.join("\n").replace(/^ERROR: /gm, "") : e.message;
  const conseil = /sign in|confirm your age|members-only|private video/i.test(cause)
    ? "Vidéo réservée aux comptes connectés : règle COOKIES_NAVIGATEUR dans studio/.env (voir .env.example)."
    : "Si l'adresse est bonne, YouTube a peut-être changé : mets yt-dlp à jour avec « npm run ytdlp:maj ».";
  return new Error(`${cause}\n${conseil}`);
}

/** Suffixe du nom de fichier pour un passage, à la milliseconde : « 12s-20.5s ». */
const secondes = (ms: number) => String(Math.round(ms) / 1000);
const suffixePassage = (debut_ms: number, fin_ms: number) => `${secondes(debut_ms)}s-${secondes(fin_ms)}s`;

/** Vidéo déjà téléchargée dans _sources/ (même identifiant, même passage). */
async function dejaTelechargee(id: string, passage: string | null): Promise<string | null> {
  const fin = passage ? `[${id}] ${passage}.mp4` : `[${id}].mp4`;
  try {
    const nom = (await readdir(dossierCopies())).find((n) => n.endsWith(fin));
    return nom ? join(dossierCopies(), nom) : null;
  } catch {
    return null;
  }
}

/** Titre, durée, vignette… avant de télécharger (quelques secondes). */
export async function infosVideo(adresse: string): Promise<InfosVideoEnLigne> {
  let sortie: string;
  try {
    ({ stdout: sortie } = await executer(config.python, [...argumentsCommuns(), "-J", "--", verifierAdresse(adresse)], { env: envPython }));
  } catch (e) {
    throw new ErreurHttp(502, erreurYtDlp(e).message);
  }
  const d = JSON.parse(sortie) as {
    _type?: string;
    id: string;
    title?: string;
    channel?: string;
    uploader?: string;
    duration?: number;
    thumbnail?: string;
    is_live?: boolean;
    extractor_key?: string;
    formats?: { height?: number | null }[];
  };
  if (d._type === "playlist") throw new ErreurHttp(400, "C'est l'adresse d'une playlist : colle celle d'une seule vidéo.");
  if (d.is_live) throw new ErreurHttp(400, "Vidéo en direct : attends la fin du direct.");
  return {
    adresse,
    id: d.id,
    site: d.extractor_key ?? null,
    titre: d.title ?? d.id,
    chaine: d.channel ?? d.uploader ?? null,
    duree_ms: d.duration ? Math.round(d.duration * 1000) : null,
    vignette: d.thumbnail ?? null,
    hauteur: Math.max(0, ...(d.formats ?? []).map((f) => f.height ?? 0)) || null,
    deja: await dejaTelechargee(d.id, null),
  };
}

export interface DemandeTelechargement {
  adresse: string;
  /** identifiant donné par infosVideo, pour réutiliser un fichier déjà téléchargé */
  id?: string;
  titre?: string;
  /** passage seul (ms), sinon toute la vidéo */
  passage?: { debut_ms: number; fin_ms: number } | null;
}

export function lancerTelechargement(demande: DemandeTelechargement): Tache {
  const adresse = verifierAdresse(demande.adresse);
  const id = demande.id && /^[\w.-]{1,64}$/.test(demande.id) ? demande.id : null;
  const p = demande.passage;
  if (p && !(Number.isFinite(p.debut_ms) && Number.isFinite(p.fin_ms) && p.debut_ms >= 0 && p.fin_ms > p.debut_ms)) {
    throw new ErreurHttp(400, "Passage invalide : la fin doit venir après le début.");
  }
  const passage = p ? suffixePassage(p.debut_ms, p.fin_ms) : null;
  const titre = demande.titre?.trim() || adresse;

  return lancerTache({ projet: null, type: "telechargement", libelle: `Téléchargement : ${titre}` }, async (ctx) => {
    const existant = id ? await dejaTelechargee(id, passage) : null;
    if (existant) return ctx.terminer("Déjà téléchargée", existant);

    const dossier = dossierCopies();
    // fichiers partiels à part : effacés d'un bloc en cas d'annulation ou d'échec
    const partiels = join(dossier, ".partiels", randomUUID());
    await mkdir(partiels, { recursive: true });
    const args = [
      ...argumentsCommuns(),
      ...FORMAT,
      "--windows-filenames",
      "-P",
      `home:${dossier}`,
      "-P",
      `temp:${partiels}`,
      "-o",
      // %(title).80B : titre coupé à 80 octets ; l'identifiant sert à retrouver le fichier
      `%(title).80B [%(id)s]${passage ? ` ${passage}` : ""}.%(ext)s`,
      ...(p ? ["--download-sections", `*${secondes(p.debut_ms)}-${secondes(p.fin_ms)}`] : []),
      "--newline",
      "--progress",
      "--progress-template",
      MODELE_AVANCEMENT,
      "--print",
      "after_move:filepath",
      "--",
      adresse,
    ];

    let chemin = null as string | null;
    ctx.progression(null, p ? "Téléchargement du passage…" : "Préparation…");
    try {
      await executer(config.python, args, {
        env: envPython,
        signal: ctx.signal,
        // yt-dlp lance ffmpeg (assemblage, passage) : l'annulation doit l'arrêter aussi
        arbre: true,
        surLigne: (ligne) => {
          if (!ligne.startsWith("@")) {
            chemin = ligne.trim();
            return;
          }
          if (p) return; // un passage passe par ffmpeg, sans avancement chiffré
          const [etat, recus, total, estime, vcodec, acodec] = ligne.slice(1).split("|");
          const taille = Number(total) || Number(estime);
          const part = taille > 0 && Number.isFinite(Number(recus)) ? Math.min(1, Number(recus) / taille) : null;
          const audioSeul = vcodec === "none";
          // la vidéo pèse l'essentiel ; l'audio (téléchargé après) compte pour la fin de la barre
          const [debut, poids] = audioSeul ? [0.9, 0.08] : acodec === "none" ? [0, 0.9] : [0, 0.98];
          const detail = etat === "finished" && audioSeul ? "Assemblage vidéo + audio…" : `${audioSeul ? "Audio" : "Vidéo"} · ${mo(Number(recus))} / ${mo(taille)}`;
          ctx.progression(part === null ? null : debut + poids * part, detail);
        },
      });
    } catch (e) {
      throw erreurYtDlp(e);
    } finally {
      // sous Windows, un fichier encore ouvert par ffmpeg peut résister : on ne masque pas l'erreur d'origine
      await rm(partiels, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
    }
    if (!chemin) throw new Error("yt-dlp n'a pas indiqué où il a rangé la vidéo.");
    ctx.terminer("Vidéo téléchargée", chemin);
  });
}

const mo = (octets: number) => (Number.isFinite(octets) && octets > 0 ? `${(octets / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo` : "?");
