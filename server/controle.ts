// Étape 7 : vérifications automatiques avant publication (fiche 7.4) : schémas JSON, répliques,
// médias à jour, durées vidéo / voice / bed égales à ±20 ms, tailles sous la limite de Cloudflare.

import { existsSync } from "node:fs";
import { config } from "./config.ts";
import { dureesFichier } from "./ffmpeg.ts";
import { chargerValideurs } from "./schemas.ts";
import { etatMedia, TAILLE_MAX_FICHIER, TOLERANCE_DUREE_MS } from "../commun/encodage.ts";
import {
  construireFabrication,
  construireInfo,
  construireRepliques,
  dureeExtrait,
  personnagesPublies,
} from "../commun/publication.ts";
import { problemesRepliques } from "../commun/repliques.ts";
import { formaterTemps } from "../commun/temps.ts";
import { FICHIERS_MEDIAS, MEDIAS, type Projet, type ResultatControle } from "../commun/types.ts";

const mo = (octets: number) =>
  octets < 1048576
    ? `${Math.max(1, Math.round(octets / 1024))} Ko`
    : `${(octets / 1048576).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;

function resultat(titre: string, erreurs: string[], attentions: string[] = [], infos: string[] = []): ResultatControle {
  const niveau = erreurs.length > 0 ? "erreur" : attentions.length > 0 ? "attention" : "ok";
  return { niveau, titre, erreurs, attentions, infos };
}

export async function controler(p: Projet, versionMedias: number): Promise<ResultatControle[]> {
  const resultats: ResultatControle[] = [];
  const duree = dureeExtrait(p);

  // --- Infos ---
  {
    const erreurs: string[] = [];
    if (!p.infos.titre.trim()) erreurs.push("Titre manquant (étape 5).");
    if (!p.infos.categorie.trim()) erreurs.push("Catégorie manquante (étape 5).");
    if (!/^[a-z]{2}$/.test(p.infos.langue)) erreurs.push("Langue manquante (étape 5).");
    const muets = p.personnages.filter((x) => !personnagesPublies(p).some((y) => y.id === x.id));
    const attentions = muets.map((x) => `« ${x.nom} » n'a aucune réplique : il ne sera pas publié.`);
    if (p.personnages.some((x) => !x.nom.trim())) erreurs.push("Un personnage n'a pas de nom.");
    resultats.push(resultat("Infos", erreurs, attentions));
  }

  // --- Répliques ---
  {
    const problemes = problemesRepliques(p.repliques, duree, p.personnages);
    const texte = (id: number, message: string) => {
      const r = p.repliques.find((x) => x.id === id);
      return `Réplique ${id}${r ? ` (${formaterTemps(r.debut_ms)})` : ""} : ${message}`;
    };
    const erreurs = problemes.filter((x) => x.grave).map((x) => texte(x.replique, x.message));
    const attentions = problemes.filter((x) => !x.grave).map((x) => texte(x.replique, x.message));
    if (p.repliques.length === 0) erreurs.push("Aucune réplique (étape 4).");
    resultats.push(
      resultat("Répliques", erreurs, attentions, erreurs.length + attentions.length === 0 ? [`${p.repliques.length} réplique(s).`] : []),
    );
  }

  // --- Schémas JSON (le contrat avec le jeu) ---
  {
    const erreurs: string[] = [];
    try {
      const valider = await chargerValideurs(config.dossierExtraits);
      erreurs.push(...valider("info", construireInfo(p, versionMedias)));
      erreurs.push(...valider("repliques", construireRepliques(p)));
      const fabrication = construireFabrication(p);
      if (fabrication) erreurs.push(...valider("fabrication", fabrication));
      else erreurs.push("fabrication.json incomplet : découpe, empreinte, pistes ou gain manquants.");
    } catch (e) {
      erreurs.push(`Schémas illisibles dans ${config.dossierExtraits} : ${(e as Error).message}`);
    }
    resultats.push(resultat("Schémas JSON", erreurs));
  }

  // --- Médias : à jour, présents, taille, durée ---
  {
    const erreurs: string[] = [];
    const attentions: string[] = [];
    const infos: string[] = [];
    const durees: Partial<Record<string, number>> = {};
    for (const media of MEDIAS) {
      const etat = etatMedia(media, p);
      const nom = FICHIERS_MEDIAS[media];
      if (etat.etat === "bloque") erreurs.push(`${nom} : ${etat.raison}`);
      else if (etat.etat === "manquant") erreurs.push(`${nom} : pas encore encodé (étape 6).`);
      else if (etat.etat === "a_refaire") erreurs.push(`${nom} : à réencoder, les réglages ont changé (étape 6).`);
      else if (etat.etat === "images_cles") {
        attentions.push(`${nom} : les images clés ne tombent plus pile sur les débuts de répliques (réencodage conseillé, pas obligatoire).`);
      }
      const sortie = p.sortie[media];
      if (!sortie) continue;
      if (!existsSync(sortie.fichier)) {
        erreurs.push(`${nom} : fichier absent (${sortie.fichier}).`);
        continue;
      }
      if (sortie.taille_octets > TAILLE_MAX_FICHIER) erreurs.push(`${nom} : ${mo(sortie.taille_octets)}, au-delà des 25 Mo de Cloudflare Pages.`);
      else infos.push(`${nom} : ${mo(sortie.taille_octets)}`);
      if (media !== "vignette") {
        try {
          const d = await dureesFichier(sortie.fichier);
          const flux = d.flux.find((f) => f.type === (media === "video" ? "video" : "audio"));
          durees[media] = flux?.duree_ms ?? d.fichier;
        } catch (e) {
          erreurs.push(`${nom} : illisible (${(e as Error).message}).`);
        }
      }
    }
    for (const [media, d] of Object.entries(durees)) {
      if (d !== undefined && Math.abs(d - duree) > TOLERANCE_DUREE_MS) {
        erreurs.push(`${FICHIERS_MEDIAS[media as keyof typeof FICHIERS_MEDIAS]} dure ${d} ms au lieu de ${duree} ms (±${TOLERANCE_DUREE_MS} ms).`);
      }
    }
    if (Object.keys(durees).length === 3 && erreurs.length === 0) infos.push(`Durées vidéo, voice et bed égales à ±${TOLERANCE_DUREE_MS} ms.`);
    resultats.push(resultat("Médias", erreurs, attentions, infos));
  }

  return resultats;
}

export function erreursBloquantes(resultats: ResultatControle[]): string[] {
  return resultats.flatMap((r) => r.erreurs.map((e) => `${r.titre} : ${e}`));
}
