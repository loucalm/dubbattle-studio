import type { ModeleSeparation } from "./types.ts";

// Modèles de séparation proposés (tous lancés par audio-separator, qui inclut Demucs et les
// modèles d'UVR, voir fiche 7.5). Les fichiers sont téléchargés au premier usage dans studio/models.
export const MODELES_SEPARATION: ModeleSeparation[] = [
  {
    fichier: "htdemucs_ft.yaml",
    libelle: "Demucs htdemucs_ft",
    famille: "Demucs",
    description: "Très bon sur la musique. Réglage par défaut.",
    defaut: true,
  },
  {
    fichier: "htdemucs.yaml",
    libelle: "Demucs htdemucs",
    famille: "Demucs",
    description: "Plus rapide que htdemucs_ft, un peu moins précis.",
  },
  {
    fichier: "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
    libelle: "BS-Roformer (Viperx 1297)",
    famille: "Roformer",
    description: "Souvent le meilleur sur les dialogues de films. Modèle lourd (~600 Mo).",
  },
  {
    fichier: "vocals_mel_band_roformer.ckpt",
    libelle: "MelBand Roformer (Kim)",
    famille: "Roformer",
    description: "Voix très propres, utile quand les voix sont peu audibles.",
  },
  {
    fichier: "Kim_Vocal_2.onnx",
    libelle: "MDX-Net Kim Vocal 2",
    famille: "MDX-Net",
    description: "Classique d'UVR, léger et rapide.",
  },
  {
    fichier: "UVR-MDX-NET-Voc_FT.onnx",
    libelle: "MDX-Net Voc FT",
    famille: "MDX-Net",
    description: "Autre classique d'UVR, à comparer avec Kim Vocal 2.",
  },
];

export function libelleModele(fichier: string): string {
  return MODELES_SEPARATION.find((m) => m.fichier === fichier)?.libelle ?? fichier;
}
