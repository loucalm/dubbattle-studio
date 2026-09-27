// Validation par les schémas JSON du dépôt des extraits (../extraits/schema) : c'est le contrat
// commun avec le jeu. Ils sont relus à chaque validation, pour suivre leurs modifications.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

// ajv-formats est publié en CommonJS : selon le chargeur, la fonction est l'export par défaut ou son .default
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (
  ajv: Ajv2020,
) => Ajv2020;

export type NomSchema = "info" | "repliques" | "catalogue" | "fabrication";

export async function chargerValideurs(dossierExtraits: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const valideurs = {} as Record<NomSchema, ReturnType<Ajv2020["compile"]>>;
  for (const nom of ["info", "repliques", "catalogue", "fabrication"] as NomSchema[]) {
    const chemin = join(dossierExtraits, "schema", `${nom}.schema.json`);
    valideurs[nom] = ajv.compile(JSON.parse(await readFile(chemin, "utf8")));
  }

  /** Renvoie la liste des erreurs, vide si les données sont valides. */
  return function valider(nom: NomSchema, donnees: unknown): string[] {
    const v = valideurs[nom];
    if (v(donnees)) return [];
    return (v.errors ?? []).map((e) => `${nom}.json ${e.instancePath || "/"} ${e.message ?? ""}`.trim());
  };
}
