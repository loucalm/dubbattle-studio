// Types partagés entre le serveur et l'interface du Studio.
// Les formats publiés (info.json, repliques.json, fabrication.json, catalogue.json) suivent
// les schémas de ../extraits/schema : ce sont eux le contrat, pas ce fichier.

export const VERSION_STUDIO = "0.1.0";

export type Media = "video" | "voice" | "bed" | "vignette";
export const MEDIAS: Media[] = ["video", "voice", "bed", "vignette"];

export const FICHIERS_MEDIAS: Record<Media, string> = {
  video: "video.mp4",
  voice: "voice.m4a",
  bed: "bed.m4a",
  vignette: "thumbnail.webp",
};

// ---------------------------------------------------------------------------
// Projet : l'état de travail d'un extrait, gardé dans studio-workspace/<id>/projet.json
// ---------------------------------------------------------------------------

export interface PisteAudioSource {
  /** index ffprobe du flux dans le fichier */
  index: number;
  /** rang parmi les pistes audio (0 = première), utilisé par ffmpeg avec -map 0:a:<rang> */
  rang: number;
  codec: string;
  canaux: number;
  langue: string | null;
  titre: string | null;
}

export interface InfosSource {
  /** dernier chemin connu de la vidéo source (elle peut avoir été déplacée) */
  chemin: string;
  nom: string;
  taille_octets: number;
  /** "sha256:<hex>", null tant que le calcul n'est pas terminé */
  empreinte: string | null;
  duree_ms: number;
  /**
   * start_time du fichier selon ffprobe (ms, peut être négatif). Les temps du Studio suivent la
   * convention de ffmpeg : 0 = début du fichier, et « -ss T » vise ce même instant.
   */
  debut_ms: number;
  conteneur: string;
  video: {
    /** index ffprobe de la piste vidéo (une pochette peut aussi compter comme piste vidéo) */
    index?: number;
    codec: string;
    largeur: number;
    hauteur: number;
    ips: number;
    /** cadence exacte selon ffprobe (« 30000/1001 »), pour le filtre fps */
    cadence?: string;
    /** durée de la piste vidéo seule, si connue : l'audio dure souvent un peu plus longtemps */
    duree_ms?: number | null;
    /** instant (temps du Studio) de la première image : la grille des images part de là */
    decalage_ms: number;
    format_pixels: string;
    entrelacee: boolean;
  };
  pistes_audio: PisteAudioSource[];
  /**
   * Projet repris d'un extrait publié sans sa source : index ffprobe de la piste audio noté dans
   * fabrication.json, pour la retrouver quand la source sera reliée.
   */
  index_piste_publiee?: number;
}

/** Où lire les médias d'un projet dans l'interface, et à quel instant du fichier commence l'extrait. */
export interface SourcesLecture {
  video: { url: string; decalage_ms: number } | null;
  /** mélange original de la plage (mix.wav), commence à l'entrée */
  mix: string | null;
  voice: string | null;
  bed: string | null;
  /** pourquoi la vidéo manque, le cas échéant */
  raison_video: string | null;
}

export interface Decoupe {
  entree_ms: number;
  sortie_ms: number;
}

export interface Separation {
  /** identifiant local, aussi nom du dossier separations/<id> */
  id: string;
  moteur: "audio-separator";
  /** nom de fichier du modèle, tel que le connaît audio-separator */
  modele: string;
  libelle: string;
  /** plage et piste audio au moment du calcul : si elles changent, la séparation est périmée */
  decoupe: Decoupe;
  piste_audio: number;
  cree_le: string;
}

export type ChoixPiste =
  | { origine: "separation"; separation: string }
  | { origine: "import"; import: string }
  /** piste déjà publiée, reprise d'un fabrication.json sans les WAV de travail (fiche 7.6) */
  | { origine: "publie"; piste: PisteFabrication };

/** Piste retouchée dans un autre logiciel puis réimportée (fiche 7.5). */
export interface ImportPiste {
  /** identifiant local, aussi nom du fichier imports/<id>.wav (mis aux normes) */
  id: string;
  quoi: "voice" | "bed";
  /** nom du fichier importé, noté dans fabrication.json */
  nom: string;
  /** empreinte du fichier importé tel quel */
  empreinte: string;
  /** plage au moment de l'import : si elle change, l'import est périmé */
  decoupe: Decoupe;
  /** recalage appliqué (ms) : > 0 = début coupé, < 0 = silence ajouté au début */
  decalage_ms: number;
  cree_le: string;
}

/** Ce que le Studio a mesuré sur un fichier importé, avant de le mettre aux normes. */
export interface AnalyseImport {
  import: string;
  quoi: "voice" | "bed";
  nom: string;
  duree_ms: number;
  attendu_ms: number;
  /** décalage détecté par comparaison avec le mélange original, null si pas de comparaison possible */
  decalage_ms: number | null;
  confiance: number | null;
}

export interface Personnage {
  id: string;
  nom: string;
}

export interface Replique {
  id: number;
  personnage: string;
  /** millisecondes depuis le début de l'extrait */
  debut_ms: number;
  fin_ms: number;
  texte: string;
}

export interface Infos {
  titre: string;
  categorie: string;
  tags: string[];
  langue: string;
  /** instant de la vignette, depuis le début de l'extrait */
  vignette_ms: number;
}

export interface ReglagesEncodage {
  hauteur: number;
  crf: number;
  debit_max: string;
  /** débit AAC de la voice (mono), en kbit/s */
  voice_kbps: number;
  /** débit AAC du bed (stéréo), en kbit/s */
  bed_kbps: number;
}

/** Un média encodé, prêt à publier. */
export interface SortieMedia {
  /** chemin absolu : dans l'espace de travail, ou le fichier déjà publié */
  fichier: string;
  /** recette qui a produit ce fichier (voir commun/encodage.ts) */
  recette: string;
  taille_octets: number;
  empreinte: string;
  encode_le: string;
  /** vidéo seulement : débuts de répliques placés en images clés */
  images_cles?: number[];
}

/** mix.wav : l'audio original de la plage, qui sert à la séparation et à la mesure du volume. */
export interface EtatMix {
  decoupe: Decoupe;
  piste_audio: number;
  /** volume mesuré du mélange original */
  loudness_lufs: number | null;
}

export interface Projet {
  id: string;
  cree_le: string;
  modifie_le: string;
  /** dernière publication, null si jamais publié (l'id peut alors encore changer) */
  publication: { version_medias: number; le: string; commit: string | null } | null;
  source: InfosSource;
  /** rang de la piste audio utilisée (voir PisteAudioSource.rang) */
  piste_audio: number;
  /** rang de piste de l'aperçu vidéo généré, null s'il n'existe pas */
  apercu_piste: number | null;
  /** rang de piste des pics audio calculés, null s'ils n'existent pas */
  pics_piste: number | null;
  decoupe: Decoupe | null;
  mix: EtatMix | null;
  /** gain appliqué pareil à la voice et au bed pour viser -16 LUFS, mesuré sur le mix */
  gain_db: number | null;
  separations: Separation[];
  imports: ImportPiste[];
  voice: ChoixPiste | null;
  bed: ChoixPiste | null;
  personnages: Personnage[];
  repliques: Replique[];
  /** ne diminue jamais : les id de répliques ne sont jamais réutilisés */
  prochain_id_replique: number;
  infos: Infos;
  encodage: ReglagesEncodage;
  sortie: Partial<Record<Media, SortieMedia>>;
  /** transcription Whisper disponible (transcription.json) */
  transcription: { modele: string; langue: string; le: string } | null;
}

/** Champs modifiables directement depuis l'interface. */
export type ModificationProjet = Partial<
  Pick<
    Projet,
    "piste_audio" | "decoupe" | "voice" | "bed" | "personnages" | "repliques" | "prochain_id_replique" | "infos" | "encodage"
  >
>;

export interface ResumeProjet {
  id: string;
  titre: string;
  duree_ms: number | null;
  modifie_le: string;
  publication: Projet["publication"];
  source_nom: string;
}

// ---------------------------------------------------------------------------
// Formats publiés (voir ../extraits/schema)
// ---------------------------------------------------------------------------

export interface InfoJson {
  id: string;
  version_medias: number;
  titre: string;
  categorie: string;
  tags: string[];
  duree_ms: number;
  personnages: Personnage[];
  langue: string;
  fichiers: { video: string; voice: string; bed: string; vignette: string };
}

export interface RepliquesJson {
  extrait_id: string;
  repliques: Replique[];
}

export type PisteFabrication =
  | { origine: "separation"; moteur: string; modele: string }
  | { origine: "import"; fichier: string; empreinte: string };

export interface FabricationJson {
  source: {
    nom: string;
    empreinte: string;
    duree_ms: number;
    taille_octets?: number;
    piste_audio?: number;
  };
  decoupe: Decoupe;
  voice: PisteFabrication;
  bed: PisteFabrication;
  gain_db: number;
  vignette_ms: number;
  encodage: Omit<ReglagesEncodage, "voice_kbps" | "bed_kbps"> & Partial<Pick<ReglagesEncodage, "voice_kbps" | "bed_kbps">> & { ips?: number };
  studio: string;
}

export interface EntreeCatalogue {
  id: string;
  version_medias: number;
  titre: string;
  categorie: string;
  tags: string[];
  duree_ms: number;
  nb_personnages: number;
  nb_repliques: number;
}

export interface CatalogueJson {
  genere_le: string;
  extraits: EntreeCatalogue[];
}

// ---------------------------------------------------------------------------
// Tâches de fond (séparation, encodage…), suivies en direct par l'interface
// ---------------------------------------------------------------------------

export type TypeTache =
  | "empreinte"
  | "apercu"
  | "pics"
  | "separation"
  | "transcription"
  | "encodage"
  | "publication"
  | "deploiement"
  | "recherche_source"
  | "telechargement";

export type EtatTache = "attente" | "en_cours" | "ok" | "erreur" | "annulee";

export interface Tache {
  id: string;
  projet: string | null;
  type: TypeTache;
  libelle: string;
  etat: EtatTache;
  /** entre 0 et 1, null si inconnue */
  progression: number | null;
  detail: string | null;
  erreur: string | null;
  /** fichier produit par la tâche (vidéo téléchargée), une fois réussie */
  fichier: string | null;
  cree_le: string;
  fin_le: string | null;
}

// ---------------------------------------------------------------------------
// Divers échanges serveur / interface
// ---------------------------------------------------------------------------

export interface EtatOutils {
  ffmpeg: string | null;
  nvenc: boolean;
  python: string | null;
  audio_separator: string | null;
  faster_whisper: string | null;
  yt_dlp: string | null;
  git: string | null;
  cuda: boolean;
}

/** Vidéo en ligne (YouTube…) avant téléchargement, lue par yt-dlp. */
export interface InfosVideoEnLigne {
  adresse: string;
  id: string;
  /** site d'origine selon yt-dlp (« Youtube »…) */
  site: string | null;
  titre: string;
  chaine: string | null;
  duree_ms: number | null;
  vignette: string | null;
  /** plus grande hauteur d'image proposée */
  hauteur: number | null;
  /** chemin du fichier si la vidéo entière est déjà dans _sources/ */
  deja: string | null;
}

export interface ModeleSeparation {
  fichier: string;
  libelle: string;
  famille: "Demucs" | "MDX-Net" | "Roformer" | "Autre";
  description: string;
  defaut?: boolean;
}

export interface EntreeDossier {
  nom: string;
  chemin: string;
  dossier: boolean;
  taille_octets: number | null;
}

export interface ExtraitPublie {
  id: string;
  titre: string;
  version_medias: number;
  duree_ms: number;
  /** un projet existe déjà dans l'espace de travail */
  projet: boolean;
}

export type NiveauControle = "ok" | "attention" | "erreur";

export interface ResultatControle {
  niveau: NiveauControle;
  titre: string;
  erreurs: string[];
  attentions: string[];
  infos: string[];
}

export interface ApercuPublication {
  nouveau: boolean;
  version_medias: number;
  fichiers: { chemin: string; etat: "ajoute" | "modifie" | "inchange"; taille_octets: number }[];
  message: string;
  erreurs: string[];
  avertissements: string[];
  depot: { branche: string | null; en_retard: boolean; modifications_etrangeres: string[] };
}

export interface MotTranscrit {
  debut_ms: number;
  fin_ms: number;
  mot: string;
}

export interface SegmentTranscrit {
  debut_ms: number;
  fin_ms: number;
  texte: string;
  mots: MotTranscrit[];
}

export interface Transcription {
  modele: string;
  langue: string;
  segments: SegmentTranscrit[];
}

// ---------------------------------------------------------------------------
// Réponses de l'API
// ---------------------------------------------------------------------------

export interface EtatServeur {
  outils: EtatOutils;
  dossiers: { extraits: string; espace: string; modeles: string };
  url_extraits: string;
  extraits_present: boolean;
  /** fenêtres « Ouvrir » natives disponibles (Windows) */
  dialogues_natifs: boolean;
  /** dossiers de l'utilisateur fouillés pour retrouver une vidéo glissée */
  dossiers_utilisateur: string[];
  modeles_separation: ModeleSeparation[];
  taches: Tache[];
}

export type EtatMediaApi =
  | { etat: "bloque"; raison: string }
  | { etat: "manquant" | "a_refaire" | "images_cles" | "a_jour" };

export interface DetailProjet {
  projet: Projet;
  lecture: SourcesLecture;
  source_presente: boolean;
  etats_medias: Record<Media, EtatMediaApi>;
  a_encoder: Media[];
  /** l'extrait existe dans le dépôt des extraits */
  publie: boolean;
  /** WAV de travail disponibles pour la voice et le bed choisis */
  wav: { voice: boolean; bed: boolean };
}

export interface Bibliotheque {
  projets: ResumeProjet[];
  publies: ExtraitPublie[];
}

export interface ContenuDossier {
  chemin: string | null;
  parent: string | null;
  entrees: EntreeDossier[];
}
