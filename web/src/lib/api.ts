// Appels à l'API du serveur local du Studio.

import type {
  ApercuPublication,
  Bibliotheque,
  ContenuDossier,
  DetailProjet,
  EtatServeur,
  ModificationProjet,
  Projet,
  ResultatControle,
  Tache,
  Transcription,
} from "../../../commun/types.ts";

export class ErreurApi extends Error {}

async function requete<T>(methode: string, chemin: string, corps?: unknown): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(chemin, {
      method: methode,
      headers: corps !== undefined ? { "content-type": "application/json" } : {},
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
  } catch {
    throw new ErreurApi("Serveur du Studio injoignable : est-il lancé (npm run studio) ?");
  }
  const donnees = (await reponse.json().catch(() => ({}))) as { erreur?: string };
  if (!reponse.ok) throw new ErreurApi(donnees.erreur ?? `Erreur ${reponse.status}`);
  return donnees as T;
}

const projet = (id: string) => `/api/projets/${encodeURIComponent(id)}`;

export const api = {
  etat: (rafraichir = false) => requete<EtatServeur>("GET", `/api/etat${rafraichir ? "?rafraichir" : ""}`),
  bibliotheque: () => requete<Bibliotheque>("GET", "/api/bibliotheque"),
  vocabulaire: () => requete<{ categories: string[]; tags: string[] }>("GET", "/api/vocabulaire"),
  reglages: () => requete<{ dossiers_sources: string[] }>("GET", "/api/reglages"),
  ecrireReglages: (r: { dossiers_sources: string[] }) => requete<{ dossiers_sources: string[] }>("PUT", "/api/reglages", r),
  dossier: (chemin?: string) =>
    requete<ContenuDossier>("GET", `/api/fichiers${chemin ? `?dossier=${encodeURIComponent(chemin)}` : ""}`),
  chercherFichier: (nom: string, taille: number) =>
    requete<{ chemins: string[] }>("POST", "/api/fichiers/chercher", { nom, taille }),
  identifiant: (nom: string) => requete<{ id: string }>("POST", "/api/identifiant", { nom }),
  annulerTache: (id: string) => requete<{ ok: boolean }>("POST", `/api/taches/${id}/annuler`, {}),

  creerProjet: (chemin: string, id: string) => requete<Projet>("POST", "/api/projets", { chemin, id }),
  ouvrirPublie: (id: string) => requete<Projet>("POST", `/api/publies/${encodeURIComponent(id)}/ouvrir`, {}),
  projet: (id: string) => requete<DetailProjet>("GET", projet(id)),
  modifier: (id: string, m: ModificationProjet) => requete<Projet>("PATCH", projet(id), m),
  supprimer: (id: string) => requete<unknown>("DELETE", projet(id)),
  renommer: (id: string, nouvelId: string) => requete<{ id: string }>("POST", `${projet(id)}/renommer`, { id: nouvelId }),
  relierSource: (id: string, chemin?: string) => requete<unknown>("POST", `${projet(id)}/source`, chemin ? { chemin } : {}),
  preparer: (id: string) => requete<unknown>("POST", `${projet(id)}/preparer`, {}),
  separer: (id: string, modeles: string[]) => requete<Tache[]>("POST", `${projet(id)}/separations`, { modeles }),
  supprimerSeparation: (id: string, sid: string) => requete<Projet>("DELETE", `${projet(id)}/separations/${encodeURIComponent(sid)}`),
  transcrire: (id: string) => requete<Tache>("POST", `${projet(id)}/transcription`, {}),
  transcription: (id: string) => requete<Transcription>("GET", `${projet(id)}/transcription`),
  encoder: (id: string, images_cles: boolean) => requete<Tache>("POST", `${projet(id)}/encoder`, { images_cles }),
  controle: (id: string) => requete<ResultatControle[]>("GET", `${projet(id)}/controle`),
  apercuPublication: (id: string) => requete<ApercuPublication>("GET", `${projet(id)}/publication`),
  publier: (id: string, message: string, pousser: boolean) => requete<Tache>("POST", `${projet(id)}/publier`, { message, pousser }),

  urlImage: (id: string, instantMs: number, largeur = 640) =>
    `${projet(id)}/image?t=${Math.round(instantMs)}&largeur=${largeur}`,
  urlPics: (id: string) => `${projet(id)}/pics`,
  urlMedia: (id: string, quoi: string) => `${projet(id)}/media/${quoi}`,
};
