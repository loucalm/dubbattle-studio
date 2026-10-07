// Tâches de fond (empreinte, aperçu, séparation, encodage, publication…), suivies en direct.
// Les tâches « lourdes » (GPU, encodage) passent l'une après l'autre ; les autres tout de suite.

import { randomUUID } from "node:crypto";
import { diffuser } from "./evenements.ts";
import { Annulation } from "./processus.ts";
import type { Tache, TypeTache } from "../commun/types.ts";

export interface ContexteTache {
  signal: AbortSignal;
  progression: (valeur: number | null, detail?: string) => void;
  /** message affiché une fois la tâche réussie (sinon « Terminé »), et fichier produit s'il y en a un */
  terminer: (message: string, fichier?: string) => void;
}

interface Entree {
  tache: Tache;
  controleur: AbortController;
  travail: (ctx: ContexteTache) => Promise<void>;
  lourde: boolean;
  derniereDiffusion: number;
}

const entrees = new Map<string, Entree>();
const fileLourde: Entree[] = [];
let lourdeEnCours = false;
const HISTORIQUE_MAX = 40;

function publier(entree: Entree, force = false): void {
  const maintenant = Date.now();
  // la progression est envoyée au plus 5 fois par seconde
  if (!force && maintenant - entree.derniereDiffusion < 200) return;
  entree.derniereDiffusion = maintenant;
  diffuser({ type: "tache", donnees: entree.tache });
}

async function executerEntree(entree: Entree): Promise<void> {
  const { tache, controleur } = entree;
  if (controleur.signal.aborted) return;
  tache.etat = "en_cours";
  publier(entree, true);
  let resultat: string | null = null;
  let fichier: string | null = null;
  try {
    await entree.travail({
      terminer: (message, produit) => {
        resultat = message;
        fichier = produit ?? null;
      },
      signal: controleur.signal,
      progression: (valeur, detail) => {
        tache.progression = valeur === null ? null : Math.max(0, Math.min(1, valeur));
        if (detail !== undefined) tache.detail = detail;
        publier(entree);
      },
    });
    tache.etat = controleur.signal.aborted ? "annulee" : "ok";
    if (tache.etat === "ok") {
      tache.progression = 1;
      tache.detail = resultat;
      tache.fichier = fichier;
    }
  } catch (e) {
    if (e instanceof Annulation || controleur.signal.aborted) {
      tache.etat = "annulee";
    } else {
      tache.etat = "erreur";
      tache.erreur = e instanceof Error ? e.message : String(e);
      console.error(`[tâche ${tache.libelle}]`, e);
    }
  } finally {
    tache.fin_le = new Date().toISOString();
    publier(entree, true);
    nettoyer();
  }
}

async function suivanteLourde(): Promise<void> {
  if (lourdeEnCours) return;
  const entree = fileLourde.shift();
  if (!entree) return;
  lourdeEnCours = true;
  try {
    await executerEntree(entree);
  } finally {
    lourdeEnCours = false;
    void suivanteLourde();
  }
}

function nettoyer(): void {
  const finies = [...entrees.values()].filter((e) => e.tache.fin_le).sort((a, b) => a.tache.fin_le!.localeCompare(b.tache.fin_le!));
  for (const e of finies.slice(0, Math.max(0, finies.length - HISTORIQUE_MAX))) entrees.delete(e.tache.id);
}

export interface DefinitionTache {
  projet: string | null;
  type: TypeTache;
  libelle: string;
  lourde?: boolean;
}

export function lancerTache(definition: DefinitionTache, travail: (ctx: ContexteTache) => Promise<void>): Tache {
  const tache: Tache = {
    id: randomUUID(),
    projet: definition.projet,
    type: definition.type,
    libelle: definition.libelle,
    etat: "attente",
    progression: null,
    detail: null,
    erreur: null,
    fichier: null,
    cree_le: new Date().toISOString(),
    fin_le: null,
  };
  const entree: Entree = { tache, controleur: new AbortController(), travail, lourde: !!definition.lourde, derniereDiffusion: 0 };
  entrees.set(tache.id, entree);
  publier(entree, true);
  if (entree.lourde) {
    fileLourde.push(entree);
    void suivanteLourde();
  } else {
    void executerEntree(entree);
  }
  return tache;
}

export function listerTaches(): Tache[] {
  return [...entrees.values()].map((e) => e.tache);
}

/** Tâche du même type déjà prévue ou en cours pour ce projet. */
export function tacheActive(projet: string, type: TypeTache): Tache | undefined {
  return listerTaches().find((t) => t.projet === projet && t.type === type && (t.etat === "attente" || t.etat === "en_cours"));
}

export function tachesActives(projet: string): Tache[] {
  return listerTaches().filter((t) => t.projet === projet && (t.etat === "attente" || t.etat === "en_cours"));
}

export function annulerTache(id: string): boolean {
  const entree = entrees.get(id);
  if (!entree || entree.tache.fin_le) return false;
  entree.controleur.abort();
  const rang = fileLourde.indexOf(entree);
  if (rang >= 0) {
    // pas encore commencée : on la retire de la file
    fileLourde.splice(rang, 1);
    entree.tache.etat = "annulee";
    entree.tache.fin_le = new Date().toISOString();
    publier(entree, true);
  }
  return true;
}

/** Annule les tâches de ce projet (avant de le supprimer ou de le renommer). */
export function annulerTachesProjet(projet: string): void {
  for (const t of tachesActives(projet)) annulerTache(t.id);
}
