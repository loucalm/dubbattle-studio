// Tout ce qui passe par ffmpeg / ffprobe. Réglages de référence : fiche technique, section 7.8.

import { open, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { config, dossierPython } from "./config.ts";
import { executer } from "./processus.ts";
import { argumentImagesCles, debitEnBits, ipsCible } from "../commun/encodage.ts";
import type { Decoupe, InfosSource, PisteAudioSource, ReglagesEncodage } from "../commun/types.ts";

export interface Suivi {
  signal?: AbortSignal;
  progression?: (valeur: number | null, detail?: string) => void;
}

const secondes = (ms: number) => (ms / 1000).toFixed(3);

/** Sélecteur de la piste vidéo pour -map (la première piste vidéo peut être une pochette). */
const pisteVideo = (source: InfosSource) => (source.video.index !== undefined ? `0:${source.video.index}` : "0:v:0");

// ---------------------------------------------------------------------------
// Lecture des fichiers
// ---------------------------------------------------------------------------

interface FluxProbe {
  index: number;
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  field_order?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  start_time?: string;
  channels?: number;
  duration?: string;
  disposition?: { attached_pic?: number };
  tags?: { language?: string; title?: string; DURATION?: string };
}

interface Probe {
  format: { format_name: string; duration?: string; start_time?: string };
  streams: FluxProbe[];
}

async function probe(chemin: string): Promise<Probe> {
  const { stdout } = await executer(config.ffprobe, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    chemin,
  ]);
  return JSON.parse(stdout) as Probe;
}

function fraction(texte: string | undefined): number {
  if (!texte) return 0;
  const [n, d] = texte.split("/").map(Number);
  return d ? n / d : n;
}

/** Durée d'une piste : champ duration (MP4) ou étiquette DURATION « 00:03:00.021000000 » (MKV). */
function dureeFlux(flux: FluxProbe): number | null {
  if (flux.duration && Number.isFinite(Number(flux.duration))) return Number(flux.duration) * 1000;
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(flux.tags?.DURATION ?? "");
  return m ? (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 : null;
}

/** Durée, résolution, i/s et pistes audio d'une vidéo source (étape 1). */
export async function sonderSource(
  chemin: string,
): Promise<Omit<InfosSource, "chemin" | "nom" | "taille_octets" | "empreinte">> {
  const p = await probe(chemin);
  const video = p.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!video) throw new Error("Aucune piste vidéo dans ce fichier.");
  const audios = p.streams.filter((s) => s.codec_type === "audio");
  const pistes_audio: PisteAudioSource[] = audios.map((s, rang) => ({
    index: s.index,
    rang,
    codec: s.codec_name ?? "?",
    canaux: s.channels ?? 0,
    langue: s.tags?.language ?? null,
    titre: s.tags?.title ?? null,
  }));
  // avg_frame_rate est plus fiable que r_frame_rate pour les fichiers à cadence variable
  const cadence = fraction(video.avg_frame_rate) ? video.avg_frame_rate! : video.r_frame_rate;
  const ips = fraction(cadence);
  const dureeVideo = dureeFlux(video);
  const debut = Number(p.format.start_time ?? 0) || 0;
  const debutVideo = Number(video.start_time ?? debut) || 0;
  return {
    duree_ms: Math.round(Number(p.format.duration ?? video.duration ?? 0) * 1000),
    debut_ms: Math.round(debut * 1_000_000) / 1000,
    conteneur: p.format.format_name,
    video: {
      index: video.index,
      codec: video.codec_name ?? "?",
      largeur: video.width ?? 0,
      hauteur: video.height ?? 0,
      ips: Math.round(ips * 1000) / 1000,
      cadence,
      duree_ms: dureeVideo === null ? null : Math.round(dureeVideo),
      decalage_ms: Math.round((debutVideo - debut) * 1_000_000) / 1000,
      format_pixels: video.pix_fmt ?? "?",
      entrelacee: ["tt", "bb", "tb", "bt"].includes(video.field_order ?? ""),
    },
    pistes_audio,
  };
}

/**
 * La source peut-elle être lue telle quelle par le navigateur (Chrome), avec cette piste audio ?
 * Sinon, le Studio fabrique un aperçu léger pour la découpe.
 */
export function lisibleParNavigateur(source: InfosSource, rang: number): boolean {
  // ffprobe nomme pareil le MKV et le WebM (« matroska,webm ») : on s'appuie sur l'extension
  const extension = source.nom.split(".").pop()?.toLowerCase() ?? "";
  const mp4 = source.conteneur.includes("mp4") && ["mp4", "m4v", "mov"].includes(extension);
  const webm = extension === "webm";
  const { codec, format_pixels } = source.video;
  const h264Lisible = codec === "h264" && ["yuv420p", "yuvj420p"].includes(format_pixels);
  const videoOk = (mp4 && (h264Lisible || codec === "av1")) || (webm && ["vp8", "vp9", "av1"].includes(codec));
  const piste = source.pistes_audio[rang];
  const codecsAudio = mp4 ? ["aac", "mp3", "opus"] : ["opus", "vorbis"];
  // le navigateur ne joue que la première piste audio
  const audioOk = source.pistes_audio.length === 0 || (rang === 0 && !!piste && codecsAudio.includes(piste.codec));
  // le navigateur compte le temps depuis 0, ffmpeg depuis start_time : ils doivent coïncider
  const debutNul = Math.abs(source.debut_ms) < 1;
  return videoOk && audioOk && debutNul && !source.video.entrelacee;
}

/** Durées (ms) du fichier et de chacune de ses pistes, pour le contrôle. */
export async function dureesFichier(chemin: string): Promise<{ fichier: number; flux: { type: string; duree_ms: number }[] }> {
  const p = await probe(chemin);
  return {
    fichier: Math.round(Number(p.format.duration ?? 0) * 1000),
    flux: p.streams.map((s) => ({ type: s.codec_type, duree_ms: Math.round(Number(s.duration ?? p.format.duration ?? 0) * 1000) })),
  };
}

// ---------------------------------------------------------------------------
// Exécution avec progression
// ---------------------------------------------------------------------------

/** Lance ffmpeg en suivant l'avancement (temps de sortie rapporté à la durée attendue). */
async function ffmpegSuivi(args: string[], dureeAttendueMs: number, suivi: Suivi): Promise<void> {
  await executer(config.ffmpeg, ["-hide_banner", "-nostats", "-loglevel", "error", "-progress", "pipe:1", "-y", ...args], {
    signal: suivi.signal,
    surLigne: (ligne) => {
      const m = /^out_time_us=(\d+)/.exec(ligne);
      if (m && dureeAttendueMs > 0 && suivi.progression) {
        suivi.progression(Math.min(1, Number(m[1]) / 1000 / dureeAttendueMs));
      }
    },
  });
}

/** Écrit dans un fichier temporaire puis renomme : un fichier présent est toujours complet. */
async function versFichier(dest: string, travail: (temp: string) => Promise<void>): Promise<void> {
  const extension = dest.slice(dest.lastIndexOf("."));
  const temp = `${dest.slice(0, -extension.length)}.partiel${extension}`;
  try {
    await travail(temp);
    await rename(temp, dest);
  } catch (e) {
    await rm(temp, { force: true });
    throw e;
  }
}

function filtreImage(source: InfosSource, largeurOuHauteur: { hauteurMax: number } | { largeur: number }): string {
  const filtres: string[] = [];
  if (source.video.entrelacee) filtres.push("yadif");
  // pixels carrés (sources anamorphiques), dimensions paires pour le yuv420p
  if ("largeur" in largeurOuHauteur) {
    const l = largeurOuHauteur.largeur;
    filtres.push(`scale=w=${l}:h='trunc(${l}/dar/2)*2':flags=lanczos`, "setsar=1");
  } else {
    const h = `trunc(min(${largeurOuHauteur.hauteurMax},ih)/2)*2`;
    filtres.push(`scale=w='trunc(${h}*dar/2)*2':h='${h}':flags=lanczos`, "setsar=1");
  }
  return filtres.join(",");
}

// ---------------------------------------------------------------------------
// Préparation de la source (étape 1)
// ---------------------------------------------------------------------------

let nvenc: boolean | null = null;

/** L'encodeur matériel NVIDIA accélère beaucoup l'aperçu d'un long film. */
export async function nvencDisponible(): Promise<boolean> {
  if (nvenc !== null) return nvenc;
  try {
    await executer(config.ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=black:s=256x256:d=0.2",
      "-c:v",
      "h264_nvenc",
      "-f",
      "null",
      "-",
    ]);
    nvenc = true;
  } catch {
    nvenc = false;
  }
  return nvenc;
}

/**
 * Aperçu léger (360p, image clé toutes les 12 images) pour les sources illisibles par le navigateur.
 * « -enc_time_base demux » garde les horodatages exacts de la source : sans lui, ffmpeg les arrondit
 * à sa grille d'images et l'aperçu montrerait chaque image jusqu'à une demi-image trop tard.
 */
export async function genererApercu(source: InfosSource, rang: number, dest: string, suivi: Suivi): Promise<void> {
  const encodeur = [
    ...((await nvencDisponible())
      ? ["-c:v", "h264_nvenc", "-preset", "p2", "-rc", "vbr", "-cq", "30", "-g", "12", "-bf", "0"]
      : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-g", "12", "-tune", "fastdecode"]),
    "-enc_time_base:v",
    "demux",
  ];
  const audio = source.pistes_audio.length > 0 ? ["-map", `0:a:${rang}`, "-c:a", "aac", "-b:a", "128k", "-ac", "2"] : [];
  await versFichier(dest, (temp) =>
    ffmpegSuivi(
      [
        "-i",
        source.chemin,
        "-map",
        pisteVideo(source),
        ...audio,
        "-sn",
        "-dn",
        "-vf",
        filtreImage(source, { hauteurMax: 360 }),
        ...encodeur,
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        temp,
      ],
      source.duree_ms,
      suivi,
    ),
  );
}

/** Nombre de pics par seconde dans pics.bin. */
export const PICS_PAR_SECONDE = 100;

/**
 * Pics audio de toute la source (un octet toutes les 10 ms), pour dessiner la forme d'onde de la
 * timeline de découpe sans décoder le film dans le navigateur.
 */
export async function calculerPics(source: InfosSource, rang: number, dest: string, suivi: Suivi): Promise<void> {
  const frequence = 8000;
  const parPic = frequence / PICS_PAR_SECONDE;
  const total = Math.ceil((source.duree_ms / 1000) * PICS_PAR_SECONDE) + PICS_PAR_SECONDE;
  const pics = new Uint8Array(total);
  let n = 0;
  let echantillon = 0;
  let max = 0;
  let reste = Buffer.alloc(0);

  await executer(
    config.ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-i", source.chemin, "-map", `0:a:${rang}`, "-ac", "1", "-ar", String(frequence), "-f", "f32le", "pipe:1"],
    {
      signal: suivi.signal,
      surDonnees: (morceau) => {
        const donnees = reste.length ? Buffer.concat([reste, morceau]) : morceau;
        const utiles = donnees.length - (donnees.length % 4);
        for (let o = 0; o < utiles; o += 4) {
          const v = Math.abs(donnees.readFloatLE(o));
          if (v > max) max = v;
          if (++echantillon === parPic) {
            if (n < total) pics[n++] = Math.min(255, Math.round(max * 255));
            echantillon = 0;
            max = 0;
          }
        }
        reste = Buffer.from(donnees.subarray(utiles));
        suivi.progression?.(Math.min(1, n / PICS_PAR_SECONDE / (source.duree_ms / 1000)));
      },
    },
  );
  const fichier = await open(dest, "w");
  try {
    await fichier.write(pics.subarray(0, n));
  } finally {
    await fichier.close();
  }
}

/** Image de la source à un instant donné (JPEG), pour les vignettes et l'aperçu. */
export async function capturerImage(source: InfosSource, instantMs: number, largeur: number): Promise<Buffer> {
  const { stdoutBinaire } = await executer(
    config.ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      secondes(instantMs),
      "-i",
      source.chemin,
      "-map",
      pisteVideo(source),
      "-frames:v",
      "1",
      "-vf",
      filtreImage(source, { largeur }),
      "-f",
      "image2pipe",
      "-c:v",
      "mjpeg",
      "-q:v",
      "4",
      "pipe:1",
    ],
    { binaire: true },
  );
  return stdoutBinaire;
}

// ---------------------------------------------------------------------------
// Audio de la plage (étape 3)
// ---------------------------------------------------------------------------

/** Audio original de la plage, en WAV flottant 44,1 kHz stéréo (entrée de la séparation). */
export async function extraireMix(source: InfosSource, rang: number, decoupe: Decoupe, dest: string, suivi: Suivi) {
  const duree = decoupe.sortie_ms - decoupe.entree_ms;
  await versFichier(dest, (temp) =>
    ffmpegSuivi(
      [
        "-ss",
        secondes(decoupe.entree_ms),
        "-i",
        source.chemin,
        "-t",
        secondes(duree),
        "-map",
        `0:a:${rang}`,
        "-vn",
        "-af",
        "apad",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-c:a",
        "pcm_f32le",
        temp,
      ],
      duree,
      suivi,
    ),
  );
}

/** Volume intégré (LUFS) d'un fichier audio, null pour un silence. */
export async function mesurerLoudness(chemin: string, suivi: Suivi = {}): Promise<number | null> {
  const { stderr } = await executer(
    config.ffmpeg,
    ["-hide_banner", "-nostats", "-i", chemin, "-af", "loudnorm=I=-16:print_format=json", "-f", "null", "-"],
    { signal: suivi.signal },
  );
  const json = stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1);
  const valeur = Number((JSON.parse(json) as { input_i: string }).input_i);
  return Number.isFinite(valeur) ? valeur : null;
}

// ---------------------------------------------------------------------------
// Encodage final (étape 6)
// ---------------------------------------------------------------------------

export async function encoderVideo(
  source: InfosSource,
  decoupe: Decoupe,
  reglages: ReglagesEncodage,
  debutsRepliques: number[],
  dest: string,
  suivi: Suivi,
): Promise<void> {
  const duree = decoupe.sortie_ms - decoupe.entree_ms;
  const debit = debitEnBits(reglages.debit_max);
  const ips = ipsCible(source.video.ips);
  const divisee = ips < source.video.ips - 0.01;
  const filtres = [
    filtreImage(source, { hauteurMax: reglages.hauteur }),
    // cadence constante (les vidéos de téléphone sont souvent à cadence variable)
    `fps=${divisee || !source.video.cadence ? ips : source.video.cadence}`,
    // si la piste vidéo s'arrête avant la sortie (l'audio dure souvent un peu plus), on prolonge
    // la dernière image plutôt que de livrer une vidéo plus courte que la voice et le bed
    "tpad=stop_mode=clone:stop_duration=2",
  ];
  // un nombre d'images exact plutôt que « -t » : ffmpeg compare -t à des horodatages déjà
  // arrondis à la grille des images, ce qui peut ajouter une image en trop à la fin
  const images = Math.max(1, Math.round((duree * ips) / 1000));
  await versFichier(dest, (temp) =>
    ffmpegSuivi(
      [
        "-ss",
        secondes(decoupe.entree_ms),
        "-i",
        source.chemin,
        "-frames:v",
        String(images),
        "-map",
        pisteVideo(source),
        "-an",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-vf",
        filtres.join(","),
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        String(reglages.crf),
        "-maxrate",
        reglages.debit_max,
        "-bufsize",
        String(Math.round(debit * 2)),
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-force_key_frames",
        argumentImagesCles(duree, debutsRepliques),
        "-movflags",
        "+faststart",
        temp,
      ],
      duree,
      suivi,
    ),
  );
}

/**
 * Voice (mono, 48 kbps par défaut) ou bed (stéréo, 96 kbps par défaut), avec le même gain sur les deux pour garder
 * l'équilibre voix / fond. Le limiteur à -1 dB évite la saturation sans toucher au niveau
 * (level=0) ni décaler le son (latency=1 compense son anticipation).
 */
export async function encoderPisteAudio(
  wav: string,
  type: "voice" | "bed",
  gainDb: number,
  kbps: number,
  dureeMs: number,
  dest: string,
  suivi: Suivi,
): Promise<void> {
  const filtres = [
    "aformat=channel_layouts=stereo",
    ...(type === "voice" ? ["pan=mono|c0=0.5*c0+0.5*c1"] : []),
    `volume=${gainDb}dB`,
    "alimiter=limit=0.89:level=0:latency=1",
    "aresample=48000",
    "apad",
  ];
  await versFichier(dest, (temp) =>
    ffmpegSuivi(
      [
        "-i",
        wav,
        "-af",
        filtres.join(","),
        "-t",
        secondes(dureeMs),
        "-c:a",
        "aac",
        "-b:a",
        `${kbps}k`,
        "-map_metadata",
        "-1",
        "-movflags",
        "+faststart",
        temp,
      ],
      dureeMs,
      suivi,
    ),
  );
}

let libwebp: Promise<boolean> | null = null;

/** L'encodeur WebP de ffmpeg (absent du ffmpeg de Homebrew depuis la version 8). */
function libwebpDisponible(): Promise<boolean> {
  libwebp ??= executer(config.ffmpeg, ["-hide_banner", "-encoders"]).then(
    ({ stdout }) => /^\s*V\S*\s+libwebp\s/m.test(stdout),
    () => false,
  );
  return libwebp;
}

export async function encoderVignette(source: InfosSource, instantMs: number, dest: string, suivi: Suivi): Promise<void> {
  const image = (sortie: string, encodeur: string[]) =>
    ffmpegSuivi(
      [
        "-ss",
        secondes(instantMs),
        "-i",
        source.chemin,
        "-map",
        pisteVideo(source),
        "-frames:v",
        "1",
        "-vf",
        filtreImage(source, { largeur: 640 }),
        ...encodeur,
        sortie,
      ],
      0,
      suivi,
    );
  if (await libwebpDisponible()) {
    await versFichier(dest, (temp) => image(temp, ["-c:v", "libwebp", "-quality", "80"]));
    return;
  }
  // sans libwebp : image PNG (sans perte) par ffmpeg, puis WebP qualité 80 par Pillow (studio/.venv)
  await versFichier(dest, async (temp) => {
    const png = `${temp}.png`;
    try {
      await image(png, ["-c:v", "png"]);
      await executer(config.python, [join(dossierPython, "webp.py"), "--entree", png, "--sortie", temp, "--qualite", "80"], {
        signal: suivi.signal,
      });
    } finally {
      await rm(png, { force: true });
    }
  });
}

/** Pour les messages : « video.mp4 (3,2 Mo) ». */
export async function descriptionFichier(chemin: string): Promise<string> {
  const { size } = await stat(chemin);
  return `${basename(chemin)} (${(size / 1048576).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo)`;
}

// ---------------------------------------------------------------------------
// Retouche dans un autre logiciel (fiche 7.5)
// ---------------------------------------------------------------------------

/** Décode un fichier audio en mono flottant (pour comparer deux pistes). */
export async function decoderMono(chemin: string, frequence: number, dureeMaxMs?: number): Promise<Float32Array> {
  const morceaux: Buffer[] = [];
  await executer(
    config.ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      chemin,
      ...(dureeMaxMs ? ["-t", secondes(dureeMaxMs)] : []),
      "-ac",
      "1",
      "-ar",
      String(frequence),
      "-f",
      "f32le",
      "pipe:1",
    ],
    { surDonnees: (m) => morceaux.push(m) },
  );
  const tout = Buffer.concat(morceaux);
  const sortie = new Float32Array(Math.floor(tout.length / 4));
  for (let i = 0; i < sortie.length; i++) sortie[i] = tout.readFloatLE(i * 4);
  return sortie;
}

/** Durée d'un fichier audio (ms). */
export async function dureeAudio(chemin: string): Promise<number> {
  const d = await dureesFichier(chemin);
  return d.flux.find((f) => f.type === "audio")?.duree_ms ?? d.fichier;
}

/**
 * Remet une piste importée aux normes : WAV flottant 48 kHz stéréo, recalée, à la durée exacte
 * de l'extrait (complétée par du silence ou coupée à la fin).
 */
export async function normaliserImport(brut: string, dest: string, dureeMs: number, decalageMs: number): Promise<void> {
  const filtres = ["aformat=channel_layouts=stereo"];
  if (decalageMs > 0) filtres.push(`atrim=start=${secondes(decalageMs)}`, "asetpts=PTS-STARTPTS");
  if (decalageMs < 0) filtres.push(`adelay=${Math.round(-decalageMs)}:all=1`);
  filtres.push("aresample=48000", "apad");
  await versFichier(dest, (temp) =>
    ffmpegSuivi(["-i", brut, "-vn", "-af", filtres.join(","), "-t", secondes(dureeMs), "-c:a", "pcm_f32le", temp], dureeMs, {}),
  );
}

/** Copie à retoucher : WAV 48 kHz 24 bits, à la durée exacte de l'extrait. */
export async function exporterWav(source: string, dest: string, dureeMs: number): Promise<void> {
  await versFichier(dest, (temp) =>
    ffmpegSuivi(["-i", source, "-af", "aresample=48000,apad", "-t", secondes(dureeMs), "-c:a", "pcm_s24le", temp], dureeMs, {}),
  );
}
