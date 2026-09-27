import type { Decoupe, Personnage, Replique } from "./types.ts";

/** En dessous, une réplique est signalée comme trop courte pour être doublée confortablement. */
export const DUREE_MIN_REPLIQUE_MS = 400;

export type TypeProbleme =
  | "hors_plage"
  | "inversee"
  | "sans_personnage"
  | "sans_texte"
  | "trop_courte"
  | "chevauchement";

export interface ProblemeReplique {
  replique: number;
  type: TypeProbleme;
  /** une erreur bloque la publication, une attention non */
  grave: boolean;
  message: string;
}

export function trierRepliques(repliques: Replique[]): Replique[] {
  return [...repliques].sort((a, b) => a.debut_ms - b.debut_ms || a.id - b.id);
}

/**
 * Nouvelle découpe : les répliques sont décalées pour rester sur les mêmes mots (fiche 7.6).
 * Celles qui sortent de la nouvelle plage sont gardées telles quelles et signalées : c'est
 * à l'auteur de les supprimer ou de les déplacer.
 */
export function decalerRepliques(
  repliques: Replique[],
  ancienne: Decoupe,
  nouvelle: Decoupe,
): { repliques: Replique[]; hors_plage: number[] } {
  const decalage = ancienne.entree_ms - nouvelle.entree_ms;
  const duree = nouvelle.sortie_ms - nouvelle.entree_ms;
  const hors_plage: number[] = [];
  const decalees = repliques.map((r) => {
    const d = { ...r, debut_ms: r.debut_ms + decalage, fin_ms: r.fin_ms + decalage };
    if (d.debut_ms < 0 || d.fin_ms > duree) hors_plage.push(r.id);
    return d;
  });
  return { repliques: decalees, hors_plage };
}

export function problemesRepliques(
  repliques: Replique[],
  duree_ms: number,
  personnages: Personnage[],
): ProblemeReplique[] {
  const problemes: ProblemeReplique[] = [];
  const ids = new Set(personnages.map((p) => p.id));
  const ajouter = (replique: number, type: TypeProbleme, grave: boolean, message: string) =>
    problemes.push({ replique, type, grave, message });

  for (const r of repliques) {
    if (r.fin_ms <= r.debut_ms) ajouter(r.id, "inversee", true, "La fin est avant le début.");
    else if (r.debut_ms < 0 || r.fin_ms > duree_ms) ajouter(r.id, "hors_plage", true, "Sort de la plage de l'extrait.");
    else if (r.fin_ms - r.debut_ms < DUREE_MIN_REPLIQUE_MS) {
      ajouter(r.id, "trop_courte", false, `Moins de ${DUREE_MIN_REPLIQUE_MS} ms : difficile à doubler.`);
    }
    if (!ids.has(r.personnage)) ajouter(r.id, "sans_personnage", true, "Aucun personnage attribué.");
    if (!r.texte.trim()) ajouter(r.id, "sans_texte", true, "Texte vide.");
  }

  const triees = trierRepliques(repliques);
  for (let i = 0; i < triees.length; i++) {
    for (let j = i + 1; j < triees.length && triees[j].debut_ms < triees[i].fin_ms; j++) {
      const a = triees[i];
      const b = triees[j];
      ajouter(a.id, "chevauchement", false, `Chevauche la réplique ${b.id}.`);
      ajouter(b.id, "chevauchement", false, `Chevauche la réplique ${a.id}.`);
    }
  }
  return problemes;
}

/** Plus grand id + 1, sans jamais redescendre sous le compteur du projet. */
export function prochainIdReplique(repliques: Replique[], compteur: number): number {
  const max = repliques.reduce((m, r) => Math.max(m, r.id), 0);
  return Math.max(compteur, max + 1);
}
