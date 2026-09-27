// Réglages d'encodage (fiche 7.8) et « recettes » : une recette décrit tout ce dont dépend un
// média encodé. Si la recette actuelle du projet diffère de celle du fichier encodé, il est à
// refaire. C'est ce qui permet de ne refaire que ce qui a changé (fiche 7.6).

import type { ChoixPiste, Media, PisteFabrication, Projet, ReglagesEncodage, Replique } from "./types.ts";

export const REGLAGES_ENCODAGE_DEFAUT: ReglagesEncodage = { hauteur: 720, crf: 26, debit_max: "2M" };
export const HAUTEURS_POSSIBLES = [720, 480];
export const IPS_MAX = 30;
export const LUFS_CIBLE = -16;
export const GAIN_MAX_DB = 20;
/** Limite par fichier de Cloudflare Pages. */
export const TAILLE_MAX_FICHIER = 25 * 1024 * 1024;
/** Écart toléré entre les durées de la vidéo, de la voice et du bed. */
export const TOLERANCE_DUREE_MS = 20;

/** i/s de la source, divisées par deux tant qu'elles dépassent 30 (60 → 30, 50 → 25). */
export function ipsCible(ipsSource: number): number {
  let ips = ipsSource > 0 ? ipsSource : 25;
  while (ips > IPS_MAX + 0.01) ips /= 2;
  return Math.round(ips * 1000) / 1000;
}

/** Gain pour amener le mélange original à -16 LUFS, arrondi au dixième. */
export function gainPourLoudness(lufs: number | null): number {
  if (lufs === null || !Number.isFinite(lufs)) return 0;
  const gain = Math.max(-GAIN_MAX_DB, Math.min(GAIN_MAX_DB, LUFS_CIBLE - lufs));
  return Math.round(gain * 10) / 10;
}

/** Débuts de répliques (ms, triés, sans doublon) : chacun reçoit une image clé forcée. */
export function debutsRepliques(repliques: Replique[], duree_ms: number): number[] {
  const debuts = repliques.map((r) => r.debut_ms).filter((t) => t > 0 && t < duree_ms);
  return [...new Set(debuts)].sort((a, b) => a - b);
}

/**
 * Valeur de -force_key_frames : une image clé par seconde, plus une au début de chaque
 * réplique (les sauts dans la vidéo sont alors instantanés).
 */
export function argumentImagesCles(duree_ms: number, debuts: number[]): string {
  const temps = new Set<number>();
  for (let t = 0; t < duree_ms; t += 1000) temps.add(t);
  for (const t of debuts) temps.add(t);
  return [...temps]
    .sort((a, b) => a - b)
    .map((t) => (t / 1000).toFixed(3))
    .join(",");
}

export function debitEnBits(debit: string): number {
  const m = /^(\d+(?:\.\d+)?)([kM])$/.exec(debit);
  if (!m) return NaN;
  return Number(m[1]) * (m[2] === "M" ? 1_000_000 : 1000);
}

/** Description stable d'une piste choisie, telle qu'elle apparaît dans fabrication.json. */
export function pisteFabrication(choix: ChoixPiste, projet: Pick<Projet, "separations">): PisteFabrication | null {
  if (choix.origine === "separation") {
    const s = projet.separations.find((x) => x.id === choix.separation);
    return s ? { origine: "separation", moteur: s.moteur, modele: s.modele } : null;
  }
  if (choix.origine === "import") return { origine: "import", fichier: choix.fichier, empreinte: choix.empreinte };
  return choix.piste;
}

/** Identité d'une piste choisie : deux séparations du même modèle ne sont pas le même fichier. */
function identitePiste(choix: ChoixPiste | null, projet: Projet): unknown {
  if (!choix) return null;
  if (choix.origine === "separation") return { ...pisteFabrication(choix, projet), separation: choix.separation };
  return pisteFabrication(choix, projet);
}

/**
 * Version de la façon d'encoder chaque média : l'augmenter quand une commande ffmpeg change,
 * pour que les fichiers déjà encodés soient signalés « à refaire ».
 */
const VERSIONS_RECETTE: Record<Media, number> = { video: 2, voice: 1, bed: 1, vignette: 1 };

export function recette(media: Media, projet: Projet): string | null {
  const texte = recetteBrute(media, projet);
  return texte === null ? null : `v${VERSIONS_RECETTE[media]}:${texte}`;
}

function recetteBrute(media: Media, projet: Projet): string | null {
  const { source, decoupe, encodage } = projet;
  if (!decoupe || !source.empreinte) return null;
  const base = { source: source.empreinte, decoupe };
  switch (media) {
    case "video":
      return JSON.stringify({ ...base, ...encodage, ips: ipsCible(source.video.ips) });
    case "voice":
    case "bed": {
      const choix = projet[media];
      if (!choix || projet.gain_db === null) return null;
      return JSON.stringify({ ...base, piste: identitePiste(choix, projet), gain_db: projet.gain_db });
    }
    case "vignette":
      return JSON.stringify({ source: source.empreinte, instant_ms: decoupe.entree_ms + projet.infos.vignette_ms });
  }
}

export type EtatMedia =
  | { etat: "bloque"; raison: string }
  | { etat: "manquant" }
  | { etat: "a_refaire" }
  /** vidéo à jour, mais ses images clés ne tombent plus pile sur les débuts de répliques */
  | { etat: "images_cles" }
  | { etat: "a_jour" };

export function etatMedia(media: Media, projet: Projet): EtatMedia {
  if (!projet.decoupe) return { etat: "bloque", raison: "Découpe à faire (étape 2)." };
  if (!projet.source.empreinte) return { etat: "bloque", raison: "Empreinte de la source en cours de calcul." };
  if ((media === "voice" || media === "bed") && !projet[media]) {
    return { etat: "bloque", raison: `Choisir la piste ${media} (étape 3).` };
  }
  if ((media === "voice" || media === "bed") && projet.gain_db === null) {
    return { etat: "bloque", raison: "Volume du mélange original pas encore mesuré (étape 3)." };
  }
  const sortie = projet.sortie[media];
  if (!sortie) return { etat: "manquant" };
  if (sortie.recette !== recette(media, projet)) return { etat: "a_refaire" };
  if (media === "video") {
    const attendus = debutsRepliques(projet.repliques, projet.decoupe.sortie_ms - projet.decoupe.entree_ms);
    if (JSON.stringify(attendus) !== JSON.stringify(sortie.images_cles ?? [])) return { etat: "images_cles" };
  }
  return { etat: "a_jour" };
}
