import { describe, expect, it } from "vitest";
import { caleSurImage, formaterTemps, lireTemps } from "../commun/temps.ts";
import { identifiantDepuisFichier, identifiantLibre, identifiantValide, versIdentifiant } from "../commun/identifiants.ts";
import { decalerRepliques, problemesRepliques, prochainIdReplique } from "../commun/repliques.ts";
import {
  argumentImagesCles,
  debutsRepliques,
  etatMedia,
  gainPourLoudness,
  ipsCible,
  recette,
} from "../commun/encodage.ts";
import { detecterParole } from "../commun/vad.ts";
import { exempleProjet } from "./exemple-projet.ts";

describe("temps", () => {
  it("formate et relit les temps", () => {
    expect(formaterTemps(7_384_200)).toBe("2:03:04.200");
    expect(formaterTemps(62_050)).toBe("01:02.050");
    expect(lireTemps("2:03:04.2")).toBe(7_384_200);
    expect(lireTemps("01:02,05")).toBe(62_050);
    expect(lireTemps("12.5")).toBe(12_500);
    expect(lireTemps("1:75")).toBeNull();
    expect(lireTemps("abc")).toBeNull();
  });

  it("cale un temps juste avant l'image la plus proche", () => {
    expect(caleSurImage(1010, 25)).toBe(999);
    expect(caleSurImage(1030, 25)).toBe(1039);
    expect(caleSurImage(10, 25)).toBe(0);
    // grille décalée (start_time négatif de la source) : images à 21, 62.7, 104.4… ms
    const ips = 23.976;
    expect(caleSurImage(58_010, ips, 21)).toBe(57_994);
    expect(caleSurImage(58_030, ips, 21)).toBe(58_036);
  });
});

describe("identifiants", () => {
  it("fabrique des identifiants sans accents", () => {
    expect(versIdentifiant("La Proue du Titanic !")).toBe("la-proue-du-titanic");
    expect(versIdentifiant("Élève & Cœur")).toBe("eleve-coeur");
    expect(identifiantDepuisFichier("Titanic.1997.1080p.mkv")).toBe("titanic-1997-1080p");
    expect(identifiantValide("titanic-proue")).toBe(true);
    expect(identifiantValide("Titanic")).toBe(false);
    expect(identifiantValide("a--b")).toBe(false);
  });

  it("évite les identifiants déjà pris", () => {
    expect(identifiantLibre("jack", new Set(["jack", "jack-2"]))).toBe("jack-3");
    expect(identifiantLibre("rose", new Set(["jack"]))).toBe("rose");
  });
});

describe("répliques", () => {
  const repliques = [
    { id: 1, personnage: "jack", debut_ms: 1000, fin_ms: 3000, texte: "a" },
    { id: 2, personnage: "rose", debut_ms: 8000, fin_ms: 9000, texte: "b" },
  ];

  it("décale les répliques quand l'entrée change, et signale celles qui sortent", () => {
    const { repliques: decalees, hors_plage } = decalerRepliques(
      repliques,
      { entree_ms: 10_000, sortie_ms: 20_000 },
      { entree_ms: 10_500, sortie_ms: 18_500 },
    );
    expect(decalees.map((r) => [r.debut_ms, r.fin_ms])).toEqual([
      [500, 2500],
      [7500, 8500],
    ]);
    expect(hors_plage).toEqual([2]);
  });

  it("signale chevauchements, répliques trop courtes et personnages inconnus", () => {
    const problemes = problemesRepliques(
      [
        { id: 1, personnage: "jack", debut_ms: 0, fin_ms: 2000, texte: "a" },
        { id: 2, personnage: "rose", debut_ms: 1500, fin_ms: 1700, texte: "b" },
        { id: 3, personnage: "cal", debut_ms: 3000, fin_ms: 4000, texte: " " },
      ],
      10_000,
      [
        { id: "jack", nom: "Jack" },
        { id: "rose", nom: "Rose" },
      ],
    );
    const types = problemes.map((p) => `${p.replique}:${p.type}`).sort();
    expect(types).toEqual(["1:chevauchement", "2:chevauchement", "2:trop_courte", "3:sans_personnage", "3:sans_texte"]);
  });

  it("ne réutilise jamais un id", () => {
    expect(prochainIdReplique(repliques, 1)).toBe(3);
    expect(prochainIdReplique([repliques[0]], 3)).toBe(3);
  });
});

describe("encodage", () => {
  it("plafonne les i/s à 30", () => {
    expect(ipsCible(23.976)).toBe(23.976);
    expect(ipsCible(59.94)).toBe(29.97);
    expect(ipsCible(50)).toBe(25);
    expect(ipsCible(120)).toBe(30);
  });

  it("calcule le gain vers -16 LUFS", () => {
    expect(gainPourLoudness(-13.6)).toBe(-2.4);
    expect(gainPourLoudness(-50)).toBe(20);
    expect(gainPourLoudness(null)).toBe(0);
  });

  it("place une image clé par seconde et au début de chaque réplique", () => {
    const debuts = debutsRepliques(exempleProjet().repliques, 4000);
    expect(debuts).toEqual([3200]);
    expect(argumentImagesCles(4000, debuts)).toBe("0.000,1.000,2.000,3.000,3.200");
  });

  it("le débit audio ne touche que son fichier, et pas aux valeurs par défaut", () => {
    const projet = exempleProjet();
    const avant = (m: "video" | "voice" | "bed") => recette(m, projet);
    const [video, voice, bed] = [avant("video"), avant("voice"), avant("bed")];
    // Recette d'avant le réglage des débits : rien ne doit être à refaire
    expect(voice).not.toContain("kbps");
    projet.encodage.voice_kbps = 40;
    expect(avant("voice")).not.toBe(voice);
    expect(avant("bed")).toBe(bed);
    expect(avant("video")).toBe(video);
    projet.encodage.voice_kbps = 48;
    projet.encodage.bed_kbps = 64;
    expect(avant("voice")).toBe(voice);
    expect(avant("bed")).not.toBe(bed);
    expect(avant("video")).toBe(video);
  });

  it("ne refait que ce qui a changé", () => {
    const projet = exempleProjet();
    for (const media of ["video", "voice", "bed", "vignette"] as const) {
      projet.sortie[media] = {
        fichier: `x/${media}`,
        recette: recette(media, projet)!,
        taille_octets: 1,
        empreinte: "sha256:x",
        encode_le: "",
        images_cles: media === "video" ? debutsRepliques(projet.repliques, 42_000) : undefined,
      };
    }
    expect(etatMedia("video", projet)).toEqual({ etat: "a_jour" });

    // Un texte de réplique : aucun média à refaire
    projet.repliques[0].texte = "Je vole, Jack !";
    expect(["video", "voice", "bed", "vignette"].map((m) => etatMedia(m as "video", projet).etat)).toEqual([
      "a_jour",
      "a_jour",
      "a_jour",
      "a_jour",
    ]);

    // Un timecode de réplique : la vidéo peut être réencodée pour ses images clés
    projet.repliques[0].debut_ms = 8100;
    expect(etatMedia("video", projet)).toEqual({ etat: "images_cles" });

    // La vignette : seule la vignette est à refaire
    projet.infos.vignette_ms = 5000;
    expect(etatMedia("vignette", projet)).toEqual({ etat: "a_refaire" });
    expect(etatMedia("voice", projet)).toEqual({ etat: "a_jour" });

    // Une nouvelle découpe : tout est à refaire
    projet.decoupe = { entree_ms: 7_384_000, sortie_ms: 7_426_200 };
    expect(etatMedia("voice", projet)).toEqual({ etat: "a_refaire" });
    expect(etatMedia("video", projet)).toEqual({ etat: "a_refaire" });
  });
});

describe("détection de parole", () => {
  it("trouve deux segments séparés par un long silence", () => {
    const frequence = 16_000;
    const signal = new Float32Array(frequence * 4);
    const sinus = (debutS: number, finS: number) => {
      for (let i = debutS * frequence; i < finS * frequence; i++) signal[i] = 0.3 * Math.sin(i / 5);
    };
    sinus(0.5, 1.5);
    sinus(2.5, 3.2);
    const segments = detecterParole([signal], frequence);
    expect(segments).toHaveLength(2);
    expect(segments[0].debut_ms).toBe(350);
    expect(segments[0].fin_ms).toBe(1650);
    expect(segments[1].debut_ms).toBe(2350);
  });
});
