// Lancement des outils natifs (ffmpeg, python, git) avec suivi ligne à ligne et annulation.

import { spawn } from "node:child_process";

export class ErreurProcessus extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly sortieErreur: string,
  ) {
    super(message);
  }
}

export class Annulation extends Error {
  constructor() {
    super("Annulé");
  }
}

export interface OptionsExecution {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** chaque ligne de la sortie standard (les \r de tqdm comptent comme des fins de ligne) */
  surLigne?: (ligne: string) => void;
  /** chaque ligne de la sortie d'erreur */
  surLigneErreur?: (ligne: string) => void;
  /** reçoit la sortie standard brute au lieu de la garder en mémoire (flux binaires) */
  surDonnees?: (morceau: Buffer) => void;
  /** garde la sortie standard en binaire (images) */
  binaire?: boolean;
  /** codes de sortie considérés comme un succès */
  codesOk?: number[];
  /** l'annulation arrête aussi les processus lancés par celui-ci (ffmpeg lancé par yt-dlp…) */
  arbre?: boolean;
}

export interface ResultatExecution {
  code: number;
  stdout: string;
  stdoutBinaire: Buffer;
  stderr: string;
}

function decoupeurLignes(cible?: (ligne: string) => void) {
  let reste = "";
  return {
    ajouter(texte: string) {
      if (!cible) return;
      reste += texte;
      const lignes = reste.split(/\r\n|\r|\n/);
      reste = lignes.pop() ?? "";
      for (const l of lignes) if (l.trim()) cible(l);
    },
    finir() {
      if (cible && reste.trim()) cible(reste);
      reste = "";
    },
  };
}

export function executer(commande: string, args: string[], options: OptionsExecution = {}): Promise<ResultatExecution> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Annulation());
    const enfant = spawn(commande, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      // hors Windows, un groupe de processus à lui, pour tous les arrêter d'un coup
      detached: !!options.arbre && process.platform !== "win32",
    });

    const morceaux: Buffer[] = [];
    let erreurs = "";
    const lignes = decoupeurLignes(options.surLigne);
    const lignesErreur = decoupeurLignes(options.surLigneErreur);

    enfant.stdout.on("data", (morceau: Buffer) => {
      if (options.surDonnees) options.surDonnees(morceau);
      else morceaux.push(morceau);
      if (options.surLigne) lignes.ajouter(morceau.toString("utf8"));
    });
    enfant.stderr.on("data", (morceau: Buffer) => {
      const texte = morceau.toString("utf8");
      erreurs += texte;
      // on ne garde que la fin : ffmpeg et tqdm peuvent être bavards
      if (erreurs.length > 200_000) erreurs = erreurs.slice(-100_000);
      lignesErreur.ajouter(texte);
    });

    const annuler = () => {
      if (!options.arbre || enfant.pid === undefined) return void enfant.kill();
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(enfant.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => enfant.kill());
      } else {
        try {
          process.kill(-enfant.pid, "SIGTERM");
        } catch {
          enfant.kill();
        }
      }
    };
    options.signal?.addEventListener("abort", annuler, { once: true });

    enfant.on("error", (e: NodeJS.ErrnoException) => {
      options.signal?.removeEventListener("abort", annuler);
      if (e.code === "ENOENT") reject(new ErreurProcessus(`Programme introuvable : ${commande}`, null, ""));
      else reject(e);
    });

    enfant.on("close", (code) => {
      options.signal?.removeEventListener("abort", annuler);
      lignes.finir();
      lignesErreur.finir();
      if (options.signal?.aborted) return reject(new Annulation());
      const stdoutBinaire = Buffer.concat(morceaux);
      const resultat = {
        code: code ?? -1,
        stdout: options.binaire ? "" : stdoutBinaire.toString("utf8"),
        stdoutBinaire,
        stderr: erreurs,
      };
      if ((options.codesOk ?? [0]).includes(resultat.code)) return resolve(resultat);
      const fin = erreurs.trim().split(/\r?\n/).slice(-8).join("\n");
      reject(new ErreurProcessus(`${nomCourt(commande)} a échoué (code ${code})${fin ? ` :\n${fin}` : ""}`, code, erreurs));
    });
  });
}

function nomCourt(commande: string): string {
  return commande.split(/[\\/]/).pop() ?? commande;
}
