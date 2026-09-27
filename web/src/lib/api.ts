// Appels à l'API du serveur local du Studio.

import type {
  AnalyseImport,
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

/** Envoi d'un fichier (corps binaire) avec suivi de l'avancement. */
function envoyerFichier<T>(url: string, fichier: File, progression?: (v: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader("x-studio", "1");
    xhr.upload.onprogress = (e) => e.lengthComputable && progression?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ErreurApi("Envoi interrompu : le serveur du Studio est-il lancé ?"));
    xhr.onload = () => {
      let donnees: { erreur?: string } = {};
      try {
        donnees = JSON.parse(xhr.responseText) as { erreur?: string };
      } catch {
        // réponse vide
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(donnees as T);
      else reject(new ErreurApi(donnees.erreur ?? `Erreur ${xhr.status}`));
    };
    xhr.send(fichier);
  });
}

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
  identifiant: (titre: string, nom: string) => requete<{ id: string }>("POST", "/api/identifiant", { titre, nom }),
  /** Fenêtre « Ouvrir » de Windows ; chemin null si annulée. */
  dialogue: (type: "video" | "audio" | "dossier", titre: string) =>
    requete<{ chemin: string | null }>("POST", "/api/dialogue", { type, titre }),
  /** Copie une vidéo glissée qu'on ne retrouve pas sur le disque. */
  televerser: (fichier: File, progression?: (v: number) => void) =>
    envoyerFichier<{ chemin: string }>(
      `/api/televersement?nom=${encodeURIComponent(fichier.name)}&taille=${fichier.size}`,
      fichier,
      progression,
    ),
  annulerTache: (id: string) => requete<{ ok: boolean }>("POST", `/api/taches/${id}/annuler`, {}),

  creerProjet: (chemin: string, titre: string) => requete<Projet>("POST", "/api/projets", { chemin, titre }),
  ouvrirPublie: (id: string) => requete<Projet>("POST", `/api/publies/${encodeURIComponent(id)}/ouvrir`, {}),
  projet: (id: string) => requete<DetailProjet>("GET", projet(id)),
  modifier: (id: string, m: ModificationProjet) => requete<Projet>("PATCH", projet(id), m),
  supprimer: (id: string) => requete<unknown>("DELETE", projet(id)),
  /** L'identifiant suit le titre tant que l'extrait n'est pas publié. */
  renommer: (id: string, titre: string) => requete<{ id: string }>("POST", `${projet(id)}/renommer`, { titre }),
  relierSource: (id: string, chemin?: string) => requete<unknown>("POST", `${projet(id)}/source`, chemin ? { chemin } : {}),
  preparer: (id: string) => requete<unknown>("POST", `${projet(id)}/preparer`, {}),
  separer: (id: string, modeles: string[]) => requete<Tache[]>("POST", `${projet(id)}/separations`, { modeles }),
  supprimerSeparation: (id: string, sid: string) => requete<Projet>("DELETE", `${projet(id)}/separations/${encodeURIComponent(sid)}`),
  importer: (id: string, quoi: "voice" | "bed", fichier: File, progression?: (v: number) => void) =>
    envoyerFichier<AnalyseImport>(
      `${projet(id)}/imports?quoi=${quoi}&nom=${encodeURIComponent(fichier.name)}`,
      fichier,
      progression,
    ),
  validerImport: (id: string, iid: string, decalage_ms: number) =>
    requete<Projet>("POST", `${projet(id)}/imports/${encodeURIComponent(iid)}/valider`, { decalage_ms }),
  supprimerImport: (id: string, iid: string) => requete<Projet>("DELETE", `${projet(id)}/imports/${encodeURIComponent(iid)}`),
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
  /** Téléchargement d'une piste à retoucher : original, separation-<id>-voice|bed, import-<id>. */
  urlExport: (id: string, piste: string) => `${projet(id)}/export/${encodeURIComponent(piste)}`,
};
