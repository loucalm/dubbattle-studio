// Identifiants d'extraits et de personnages : minuscules, chiffres et tirets, sans accents.

export const MOTIF_IDENTIFIANT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const LONGUEUR_MAX_IDENTIFIANT = 64;

export function identifiantValide(id: string): boolean {
  return id.length <= LONGUEUR_MAX_IDENTIFIANT && MOTIF_IDENTIFIANT.test(id);
}

/** « La Proue du Titanic ! » → « la-proue-du-titanic » */
export function versIdentifiant(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LONGUEUR_MAX_IDENTIFIANT)
    .replace(/-+$/g, "");
}

/** Identifiant proposé à partir d'un nom de fichier vidéo (sans l'extension). */
export function identifiantDepuisFichier(nom: string): string {
  const sansExtension = nom.replace(/\.[^.]+$/, "");
  return versIdentifiant(sansExtension) || "extrait";
}

/** Ajoute -2, -3… si l'identifiant est déjà pris. */
export function identifiantLibre(base: string, pris: Set<string>): string {
  if (!pris.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffixe = `-${n}`;
    const candidat = base.slice(0, LONGUEUR_MAX_IDENTIFIANT - suffixe.length) + suffixe;
    if (!pris.has(candidat)) return candidat;
  }
}
