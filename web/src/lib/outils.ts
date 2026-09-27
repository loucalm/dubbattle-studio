// Petites fonctions d'affichage et de saisie.

import { couleurPersonnage } from "../../../commun/couleurs.ts";
import type { Personnage } from "../../../commun/types.ts";

export function tailleLisible(octets: number | null | undefined): string {
  if (octets === null || octets === undefined) return "";
  if (octets < 1024) return `${octets} o`;
  if (octets < 1048576) return `${Math.round(octets / 1024)} Ko`;
  if (octets < 1073741824) return `${(octets / 1048576).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
  return `${(octets / 1073741824).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} Go`;
}

export function dateLisible(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

/** Vrai si la touche vient d'un champ de saisie : les raccourcis clavier ne s'appliquent pas. */
export function dansUnChamp(e: KeyboardEvent): boolean {
  const cible = e.target as HTMLElement | null;
  if (!cible) return false;
  return cible.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(cible.tagName);
}

export function couleurDe(personnages: Personnage[], id: string): string {
  return couleurPersonnage(personnages.findIndex((p) => p.id === id));
}

/** Pics (valeur crête par colonne) d'une fenêtre d'un tampon audio, pour dessiner une forme d'onde. */
export function picsTampon(tampon: AudioBuffer, colonnes: number, debutS = 0, finS = tampon.duration): Float32Array {
  const frequence = tampon.sampleRate;
  const debut = Math.max(0, Math.floor(debutS * frequence));
  const fin = Math.min(tampon.length, Math.ceil(finS * frequence));
  const canaux = Array.from({ length: tampon.numberOfChannels }, (_, c) => tampon.getChannelData(c));
  const pics = new Float32Array(colonnes);
  const parColonne = (fin - debut) / colonnes;
  for (let col = 0; col < colonnes; col++) {
    const a = Math.floor(debut + col * parColonne);
    const b = Math.min(fin, Math.floor(debut + (col + 1) * parColonne));
    let max = 0;
    // au-delà de quelques milliers d'échantillons par colonne, on en saute pour rester fluide
    const pas = Math.max(1, Math.floor((b - a) / 2000));
    for (let i = a; i < b; i += pas) {
      for (const c of canaux) {
        const v = Math.abs(c[i]);
        if (v > max) max = v;
      }
    }
    pics[col] = max;
  }
  return pics;
}
