import { REGLAGES_ENCODAGE_DEFAUT } from "../commun/encodage.ts";
import type { Projet } from "../commun/types.ts";

/** Projet complet et cohérent, prêt à encoder et publier, pour les tests. */
export function exempleProjet(): Projet {
  return {
    id: "titanic-proue",
    cree_le: "2026-09-27T10:00:00.000Z",
    modifie_le: "2026-09-27T10:00:00.000Z",
    publication: null,
    source: {
      chemin: "D:/films/Titanic.1997.mkv",
      nom: "Titanic.1997.mkv",
      taille_octets: 8_000_000_000,
      empreinte: "sha256:" + "9f2c".repeat(16),
      duree_ms: 11_640_000,
      debut_ms: 0,
      conteneur: "matroska,webm",
      video: { codec: "h264", largeur: 1920, hauteur: 1080, ips: 23.976, decalage_ms: 0, format_pixels: "yuv420p", entrelacee: false },
      pistes_audio: [
        { index: 1, rang: 0, codec: "ac3", canaux: 6, langue: "fre", titre: "VF" },
        { index: 2, rang: 1, codec: "ac3", canaux: 6, langue: "eng", titre: "VO" },
      ],
    },
    piste_audio: 0,
    apercu_piste: 0,
    pics_piste: 0,
    decoupe: { entree_ms: 7_384_200, sortie_ms: 7_426_200 },
    mix: { decoupe: { entree_ms: 7_384_200, sortie_ms: 7_426_200 }, piste_audio: 0, loudness_lufs: -13.6 },
    gain_db: -2.4,
    separations: [
      {
        id: "s1",
        moteur: "audio-separator",
        modele: "htdemucs_ft.yaml",
        libelle: "Demucs htdemucs_ft",
        decoupe: { entree_ms: 7_384_200, sortie_ms: 7_426_200 },
        piste_audio: 0,
        cree_le: "2026-09-27T10:05:00.000Z",
      },
    ],
    voice: { origine: "separation", separation: "s1" },
    bed: { origine: "separation", separation: "s1" },
    personnages: [
      { id: "jack", nom: "Jack" },
      { id: "rose", nom: "Rose" },
      { id: "cal", nom: "Cal" },
    ],
    repliques: [
      { id: 2, personnage: "rose", debut_ms: 8000, fin_ms: 10_500, texte: "Je vole !" },
      { id: 1, personnage: "jack", debut_ms: 3200, fin_ms: 6800, texte: "Donne-moi ta main." },
    ],
    prochain_id_replique: 3,
    infos: {
      titre: "La proue du Titanic",
      source: "Titanic (1997)",
      categorie: "Film",
      tags: ["romance", "culte"],
      langue: "fr",
      vignette_ms: 12_500,
    },
    encodage: { ...REGLAGES_ENCODAGE_DEFAUT },
    sortie: {},
    transcription: null,
  };
}
