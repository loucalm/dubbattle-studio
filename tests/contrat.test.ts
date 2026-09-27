// Ce que le Studio publie doit valider les schémas de ../extraits/schema (le contrat avec le jeu).

import { describe, expect, it } from "vitest";
import { config } from "../server/config.ts";
import { chargerValideurs } from "../server/schemas.ts";
import {
  construireCatalogue,
  construireFabrication,
  construireInfo,
  construireRepliques,
  entreeCatalogue,
  messageCommit,
} from "../commun/publication.ts";
import { exempleProjet } from "./exemple-projet.ts";

describe("fichiers publiés", async () => {
  const valider = await chargerValideurs(config.dossierExtraits);
  const projet = exempleProjet();

  it("info.json respecte le schéma et ne garde que les personnages qui parlent", () => {
    const info = construireInfo(projet, 1);
    expect(valider("info", info)).toEqual([]);
    expect(info.personnages.map((p) => p.id)).toEqual(["jack", "rose"]);
    expect(info.duree_ms).toBe(42_000);
    expect(Object.keys(info).slice(0, 4)).toEqual(["id", "version_medias", "titre", "source"]);
  });

  it("repliques.json respecte le schéma, trié dans l'ordre du film", () => {
    const repliques = construireRepliques(projet);
    expect(valider("repliques", repliques)).toEqual([]);
    expect(repliques.repliques.map((r) => r.id)).toEqual([1, 2]);
  });

  it("fabrication.json respecte le schéma", () => {
    const fabrication = construireFabrication(projet);
    expect(fabrication).not.toBeNull();
    expect(valider("fabrication", fabrication)).toEqual([]);
    expect(fabrication!.source.piste_audio).toBe(1);
    expect(fabrication!.voice).toEqual({ origine: "separation", moteur: "audio-separator", modele: "htdemucs_ft.yaml" });
  });

  it("catalogue.json respecte le schéma", () => {
    const entree = entreeCatalogue(construireInfo(projet, 3), construireRepliques(projet));
    const catalogue = construireCatalogue([entree], new Date("2026-09-27T21:00:00.123Z"));
    expect(valider("catalogue", catalogue)).toEqual([]);
    expect(catalogue.genere_le).toBe("2026-09-27T21:00:00Z");
    expect(catalogue.extraits[0]).toMatchObject({ nb_personnages: 2, nb_repliques: 2, version_medias: 3 });
  });

  it("un schéma refuse un id avec des majuscules", () => {
    const info = { ...construireInfo(projet, 1), id: "Titanic" };
    expect(valider("info", info).length).toBeGreaterThan(0);
  });

  it("propose un message de commit clair", () => {
    const base = { nouveau: false, info: false, repliques: false, fabrication: false, medias: [] as string[] };
    expect(messageCommit("titanic-proue", { ...base, nouveau: true })).toBe("Ajout de titanic-proue");
    expect(messageCommit("titanic-proue", { ...base, repliques: true })).toBe("titanic-proue : répliques corrigées");
    expect(messageCommit("titanic-proue", { ...base, info: true, medias: ["thumbnail.webp"] })).toBe(
      "titanic-proue : infos modifiées, médias refaits (vignette)",
    );
  });
});
