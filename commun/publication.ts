// Construction des fichiers publiés à partir d'un projet (formats : ../extraits/schema).

import { ipsCible, pisteFabrication } from "./encodage.ts";
import { trierRepliques } from "./repliques.ts";
import {
  FICHIERS_MEDIAS,
  VERSION_STUDIO,
  type CatalogueJson,
  type EntreeCatalogue,
  type FabricationJson,
  type InfoJson,
  type Projet,
  type RepliquesJson,
} from "./types.ts";

export function dureeExtrait(projet: Pick<Projet, "decoupe">): number {
  return projet.decoupe ? projet.decoupe.sortie_ms - projet.decoupe.entree_ms : 0;
}

/** Seuls les personnages qui ont au moins une réplique sont publiés, dans l'ordre du projet. */
export function personnagesPublies(projet: Pick<Projet, "personnages" | "repliques">) {
  const parlants = new Set(projet.repliques.map((r) => r.personnage));
  return projet.personnages.filter((p) => parlants.has(p.id)).map((p) => ({ id: p.id, nom: p.nom.trim() }));
}

export function construireInfo(projet: Projet, version_medias: number): InfoJson {
  const { infos } = projet;
  const info: InfoJson = {
    id: projet.id,
    version_medias,
    titre: infos.titre.trim(),
    categorie: infos.categorie.trim(),
    tags: [...new Set(infos.tags.map((t) => t.trim()).filter(Boolean))],
    duree_ms: dureeExtrait(projet),
    personnages: personnagesPublies(projet),
    langue: infos.langue,
    fichiers: { ...FICHIERS_MEDIAS },
  };
  // « source » est facultatif : on le place après le titre pour garder l'ordre de la fiche
  if (infos.source.trim()) {
    const { id, version_medias: v, titre, ...reste } = info;
    return { id, version_medias: v, titre, source: infos.source.trim(), ...reste };
  }
  return info;
}

export function construireRepliques(projet: Projet): RepliquesJson {
  return {
    extrait_id: projet.id,
    repliques: trierRepliques(projet.repliques).map((r) => ({
      id: r.id,
      personnage: r.personnage,
      debut_ms: Math.round(r.debut_ms),
      fin_ms: Math.round(r.fin_ms),
      texte: r.texte.trim(),
    })),
  };
}

/** Renvoie null si une information manque (découpe, empreinte, pistes, gain). */
export function construireFabrication(projet: Projet): FabricationJson | null {
  const { source, decoupe } = projet;
  if (!decoupe || !source.empreinte || !projet.voice || !projet.bed || projet.gain_db === null) return null;
  const voice = pisteFabrication(projet.voice, projet);
  const bed = pisteFabrication(projet.bed, projet);
  if (!voice || !bed) return null;
  const piste = source.pistes_audio[projet.piste_audio];
  return {
    source: {
      nom: source.nom,
      empreinte: source.empreinte,
      duree_ms: source.duree_ms,
      taille_octets: source.taille_octets,
      ...(piste ? { piste_audio: piste.index } : {}),
    },
    decoupe: { ...decoupe },
    voice,
    bed,
    gain_db: projet.gain_db,
    vignette_ms: projet.infos.vignette_ms,
    encodage: { ...projet.encodage, ips: ipsCible(source.video.ips) },
    studio: VERSION_STUDIO,
  };
}

export function entreeCatalogue(info: InfoJson, repliques: RepliquesJson): EntreeCatalogue {
  return {
    id: info.id,
    version_medias: info.version_medias,
    titre: info.titre,
    categorie: info.categorie,
    tags: info.tags,
    duree_ms: info.duree_ms,
    nb_personnages: info.personnages.length,
    nb_repliques: repliques.repliques.length,
  };
}

/** Catalogue trié par id, pour des différences git lisibles. */
export function construireCatalogue(entrees: EntreeCatalogue[], genere_le: Date): CatalogueJson {
  return {
    genere_le: genere_le.toISOString().replace(/\.\d{3}Z$/, "Z"),
    extraits: [...entrees].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export interface ChangementsPublication {
  nouveau: boolean;
  info: boolean;
  repliques: boolean;
  fabrication: boolean;
  medias: string[];
}

/** « Ajout de titanic-proue », « titanic-proue : répliques corrigées, vidéo réencodée ». */
export function messageCommit(id: string, c: ChangementsPublication): string {
  if (c.nouveau) return `Ajout de ${id}`;
  const parties: string[] = [];
  if (c.repliques) parties.push("répliques corrigées");
  if (c.info) parties.push("infos modifiées");
  const noms: Record<string, string> = {
    [FICHIERS_MEDIAS.video]: "vidéo",
    [FICHIERS_MEDIAS.voice]: "voice",
    [FICHIERS_MEDIAS.bed]: "bed",
    [FICHIERS_MEDIAS.vignette]: "vignette",
  };
  if (c.medias.length > 0) parties.push(`médias refaits (${c.medias.map((m) => noms[m] ?? m).join(", ")})`);
  if (parties.length === 0 && c.fabrication) parties.push("recette de fabrication mise à jour");
  return `${id} : ${parties.join(", ") || "republication"}`;
}
