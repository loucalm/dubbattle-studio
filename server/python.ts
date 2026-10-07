// Outils Python du Studio (séparation avec audio-separator, transcription avec faster-whisper),
// installés dans studio/.venv par `npm run python:installer`.

import { join } from "node:path";
import { config, dossierPython } from "./config.ts";
import { executer } from "./processus.ts";
import type { Suivi } from "./ffmpeg.ts";

const envPython = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };

export interface EtatPython {
  python: string | null;
  audio_separator: string | null;
  faster_whisper: string | null;
  yt_dlp: string | null;
  cuda: boolean;
}

export async function etatPython(): Promise<EtatPython> {
  try {
    const { stdout } = await executer(config.python, [join(dossierPython, "outils.py")], { env: envPython });
    return JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? "{}") as EtatPython;
  } catch {
    return { python: null, audio_separator: null, faster_whisper: null, yt_dlp: null, cuda: false };
  }
}

/** Lance un script Python qui écrit des lignes JSON d'avancement sur sa sortie standard. */
async function lancerScript(script: string, args: string[], suivi: Suivi, lireProgressionTqdm: boolean): Promise<void> {
  let etape = "";
  await executer(config.python, [join(dossierPython, script), ...args], {
    env: envPython,
    signal: suivi.signal,
    surLigne: (ligne) => {
      try {
        const m = JSON.parse(ligne) as { etape?: string; progression?: number };
        if (m.etape) {
          etape = m.etape;
          suivi.progression?.(null, etape);
        }
        if (typeof m.progression === "number") suivi.progression?.(m.progression, etape);
      } catch {
        // ligne non JSON : ignorée
      }
    },
    surLigneErreur: (ligne) => {
      // barres de progression tqdm : «  45%|████▌     | 9/20 [00:03<00:04, …] »
      const m = lireProgressionTqdm ? /(\d{1,3})%\|/.exec(ligne) : null;
      if (m) suivi.progression?.(Number(m[1]) / 100, etape);
    },
  });
}

export async function separer(mix: string, modele: string, dossierSortie: string, suivi: Suivi): Promise<void> {
  await lancerScript(
    "separer.py",
    ["--entree", mix, "--modele", modele, "--sortie", dossierSortie, "--modeles", join(config.dossierModeles, "audio-separator")],
    suivi,
    true,
  );
}

export async function transcrire(wav: string, langue: string | null, sortie: string, suivi: Suivi): Promise<void> {
  await lancerScript(
    "transcrire.py",
    [
      "--entree",
      wav,
      "--sortie",
      sortie,
      "--modeles",
      config.dossierModeles,
      "--modele",
      config.modeleWhisper,
      ...(langue ? ["--langue", langue] : []),
    ],
    suivi,
    false,
  );
}
