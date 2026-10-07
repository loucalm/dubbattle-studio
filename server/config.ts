// Configuration du Studio. Rien n'est écrit en dur : tout peut être changé dans studio/.env
// (voir .env.example). Les valeurs par défaut suivent l'organisation du dossier Dub-Battle-V3.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RACINE_STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.loadEnvFile(join(RACINE_STUDIO, ".env"));
} catch {
  // pas de .env : valeurs par défaut
}

const windows = process.platform === "win32";
/** Une variable absente ou vide dans .env prend la valeur par défaut. */
const env = new Proxy(process.env, { get: (cible, nom: string) => cible[nom]?.trim() || undefined });

function pythonParDefaut(): string {
  const venv = windows ? join(RACINE_STUDIO, ".venv", "Scripts", "python.exe") : join(RACINE_STUDIO, ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python";
}

export const config = {
  port: Number(env.PORT ?? 5180),
  /** clone local du dépôt dubbattle-extraits, où le Studio publie */
  dossierExtraits: resolve(env.DOSSIER_EXTRAITS ?? join(RACINE_STUDIO, "..", "extraits")),
  /** fichiers de travail (WAV intermédiaires, aperçus…), hors de tout dépôt git */
  dossierEspace: resolve(env.DOSSIER_ESPACE ?? join(RACINE_STUDIO, "..", "studio-workspace")),
  /** modèles d'IA téléchargés (séparation, transcription), ignorés par git */
  dossierModeles: resolve(env.DOSSIER_MODELES ?? join(RACINE_STUDIO, "models")),
  /** adresse publique des extraits, pour afficher le lien après publication */
  urlExtraits: (env.URL_EXTRAITS ?? "https://dubbattle-extraits.pages.dev").replace(/\/+$/, ""),
  ffmpeg: env.FFMPEG ?? "ffmpeg",
  ffprobe: env.FFPROBE ?? "ffprobe",
  python: env.PYTHON ?? pythonParDefaut(),
  git: env.GIT ?? "git",
  /** modèle Whisper pour la transcription */
  modeleWhisper: env.MODELE_WHISPER ?? "large-v3-turbo",
  /** navigateur dont yt-dlp reprend les cookies (vidéos réservées aux comptes connectés), vide = aucun */
  cookiesNavigateur: env.COOKIES_NAVIGATEUR ?? null,
  /** le Studio n'écoute que la machine locale */
  hote: "127.0.0.1",
};

export const dossierWeb = join(RACINE_STUDIO, "dist", "web");
export const dossierPython = join(RACINE_STUDIO, "python");
