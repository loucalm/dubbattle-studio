// Étape 8 : publication dans le clone local de dubbattle-extraits, puis commit et push (fiche 7.4).
// Toujours montrer ce qui va être publié avant de pousser : voir apercuPublication().

import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.ts";
import { erreursBloquantes, controler } from "./controle.ts";
import { empreinteFichier } from "./fichiers.ts";
import { executer } from "./processus.ts";
import { lireProjet, modifierProjet, ErreurHttp } from "./projets.ts";
import { chargerValideurs } from "./schemas.ts";
import { lancerTache, type ContexteTache } from "./taches.ts";
import { dossierExtraitPublie } from "./travaux.ts";
import {
  construireCatalogue,
  construireFabrication,
  construireInfo,
  construireRepliques,
  entreeCatalogue,
  messageCommit,
} from "../commun/publication.ts";
import {
  FICHIERS_MEDIAS,
  MEDIAS,
  type ApercuPublication,
  type InfoJson,
  type Media,
  type Projet,
  type RepliquesJson,
  type Tache,
} from "../commun/types.ts";

const enJson = (donnees: unknown) => `${JSON.stringify(donnees, null, 2)}\n`;

function git(args: string[], options: { signal?: AbortSignal; codesOk?: number[] } = {}) {
  return executer(config.git, ["-C", config.dossierExtraits, ...args], options);
}

// Une seule publication à la fois : elles partagent l'index git et le catalogue
let verrou: Promise<unknown> = Promise.resolve();
function unParUn<T>(operation: () => Promise<T>): Promise<T> {
  const suite = verrou.catch(() => undefined).then(operation);
  verrou = suite;
  return suite;
}

// ---------------------------------------------------------------------------
// Dépôt git
// ---------------------------------------------------------------------------

async function etatDepot(id: string): Promise<ApercuPublication["depot"]> {
  if (!existsSync(join(config.dossierExtraits, ".git"))) {
    throw new ErreurHttp(500, `${config.dossierExtraits} n'est pas un dépôt git.`);
  }
  const branche = (await git(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => null))?.stdout.trim() ?? null;
  // on regarde si GitHub a des commits qu'on n'a pas (autre PC) ; sans réseau, on continue
  await git(["fetch", "--quiet"], { signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
  const retard = await git(["rev-list", "--count", "HEAD..@{u}"]).catch(() => null);
  // les nouveaux dossiers apparaissent en bloc (« dossier/ »), sans lister chaque fichier
  const statut = await git(["status", "--porcelain", "--untracked-files=normal"]);
  const prefixe = `extraits/${id}/`;
  const modifications_etrangeres = statut.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ""))
    .filter((chemin) => !chemin.startsWith(prefixe) && chemin !== `extraits/${id}/` && chemin !== "catalogue.json");
  return { branche, en_retard: Number(retard?.stdout.trim() ?? 0) > 0, modifications_etrangeres };
}

// ---------------------------------------------------------------------------
// Préparation : ce qui va être écrit
// ---------------------------------------------------------------------------

interface Plan {
  projet: Projet;
  version_medias: number;
  nouveau: boolean;
  json: { nom: string; contenu: string; etat: "ajoute" | "modifie" | "inchange" }[];
  /** info.json change pour autre chose que version_medias */
  infoModifiee: boolean;
  medias: { media: Media; source: string; taille_octets: number; etat: "ajoute" | "modifie" | "inchange" }[];
  erreurs: string[];
  avertissements: string[];
}

/** Contenu d'un fichier texte, fins de ligne normalisées (un clone Windows peut les avoir en CRLF). */
async function lireTexte(chemin: string): Promise<string | null> {
  try {
    return (await readFile(chemin, "utf8")).replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

async function preparer(id: string): Promise<Plan> {
  const projet = await lireProjet(id);
  const dossier = dossierExtraitPublie(id);
  const infoPubliee = await lireTexte(join(dossier, "info.json"));
  const nouveau = infoPubliee === null;

  // médias : comparés par empreinte avec ceux déjà publiés
  const medias: Plan["medias"] = [];
  for (const media of MEDIAS) {
    const sortie = projet.sortie[media];
    if (!sortie) continue;
    const publie = join(dossier, "medias", FICHIERS_MEDIAS[media]);
    let etat: "ajoute" | "modifie" | "inchange" = "ajoute";
    if (existsSync(publie)) etat = (await empreinteFichier(publie)) === sortie.empreinte ? "inchange" : "modifie";
    medias.push({ media, source: sortie.fichier, taille_octets: sortie.taille_octets, etat });
  }
  // version_medias n'augmente que si un fichier de medias/ change (fiche 7.10)
  const versionPubliee = nouveau ? 0 : (JSON.parse(infoPubliee) as InfoJson).version_medias;
  const version_medias = nouveau ? 1 : versionPubliee + (medias.some((m) => m.etat !== "inchange") ? 1 : 0);

  const json: Plan["json"] = [];
  const fabrication = construireFabrication(projet);
  const contenus: [string, unknown][] = [
    ["info.json", construireInfo(projet, version_medias)],
    ["repliques.json", construireRepliques(projet)],
    ...(fabrication ? ([["fabrication.json", fabrication]] as [string, unknown][]) : []),
  ];
  for (const [nom, donnees] of contenus) {
    const contenu = enJson(donnees);
    const actuel = await lireTexte(join(dossier, nom));
    json.push({ nom, contenu, etat: actuel === null ? "ajoute" : actuel === contenu ? "inchange" : "modifie" });
  }

  const infoModifiee = nouveau || enJson(construireInfo(projet, versionPubliee)) !== infoPubliee;
  const controle = await controler(projet, version_medias);
  return {
    projet,
    version_medias,
    nouveau,
    json,
    infoModifiee,
    medias,
    erreurs: erreursBloquantes(controle),
    avertissements: controle.flatMap((r) => r.attentions.map((a) => `${r.titre} : ${a}`)),
  };
}

function aChange(plan: Plan): boolean {
  return plan.json.some((f) => f.etat !== "inchange") || plan.medias.some((m) => m.etat !== "inchange");
}

export async function apercuPublication(id: string): Promise<ApercuPublication> {
  const plan = await preparer(id);
  const depot = await etatDepot(id);
  const prefixe = `extraits/${id}`;
  const fichiers: ApercuPublication["fichiers"] = [
    ...plan.json.map((f) => ({ chemin: `${prefixe}/${f.nom}`, etat: f.etat, taille_octets: Buffer.byteLength(f.contenu) })),
    ...plan.medias.map((m) => ({ chemin: `${prefixe}/medias/${FICHIERS_MEDIAS[m.media]}`, etat: m.etat, taille_octets: m.taille_octets })),
  ];
  if (aChange(plan)) fichiers.push({ chemin: "catalogue.json", etat: "modifie", taille_octets: 0 });
  const erreurs = [...plan.erreurs];
  if (depot.en_retard) erreurs.push("Le dépôt des extraits est en retard sur GitHub : fais un « git pull » dans extraits/ avant de publier.");
  if (!aChange(plan)) erreurs.push("Rien à publier : l'extrait publié est déjà à jour.");
  return {
    nouveau: plan.nouveau,
    version_medias: plan.version_medias,
    fichiers,
    message: messageCommit(id, {
      nouveau: plan.nouveau,
      info: plan.infoModifiee,
      repliques: plan.json.find((f) => f.nom === "repliques.json")?.etat !== "inchange",
      fabrication: plan.json.find((f) => f.nom === "fabrication.json")?.etat !== "inchange",
      medias: plan.medias.filter((m) => m.etat !== "inchange").map((m) => FICHIERS_MEDIAS[m.media]),
    }),
    erreurs,
    avertissements: plan.avertissements,
    depot,
  };
}

// ---------------------------------------------------------------------------
// Écriture, catalogue, commit et push
// ---------------------------------------------------------------------------

/**
 * Seule porte de sortie des médias. Phase 1 : copie dans le dépôt (Cloudflare Pages).
 * Phase 2 : c'est ici qu'on enverra vers Cloudflare R2 (fiche 7.9), sans rien changer d'autre.
 */
async function envoyerMedias(id: string, medias: { source: string; nom: string }[]): Promise<void> {
  const dossier = join(dossierExtraitPublie(id), "medias");
  await mkdir(dossier, { recursive: true });
  for (const m of medias) await copyFile(m.source, join(dossier, m.nom));
}

/** Régénère catalogue.json à partir de tous les info.json et repliques.json du dépôt. */
async function regenererCatalogue(): Promise<void> {
  const racine = join(config.dossierExtraits, "extraits");
  const entrees = [];
  for (const nom of await readdir(racine, { withFileTypes: true })) {
    if (!nom.isDirectory()) continue;
    const info = await lireTexte(join(racine, nom.name, "info.json"));
    const repliques = await lireTexte(join(racine, nom.name, "repliques.json"));
    if (!info || !repliques) continue;
    entrees.push(entreeCatalogue(JSON.parse(info) as InfoJson, JSON.parse(repliques) as RepliquesJson));
  }
  const catalogue = construireCatalogue(entrees, new Date());
  const erreurs = (await chargerValideurs(config.dossierExtraits))("catalogue", catalogue);
  if (erreurs.length > 0) throw new Error(`Catalogue invalide : ${erreurs.join(" ; ")}`);
  await writeFile(join(config.dossierExtraits, "catalogue.json"), enJson(catalogue), "utf8");
}

async function executerPublication(id: string, message: string, pousser: boolean, ctx: ContexteTache): Promise<string> {
  ctx.progression(0.05, "Vérifications");
  const plan = await preparer(id);
  if (plan.erreurs.length > 0) throw new Error(`Publication impossible :\n${plan.erreurs.join("\n")}`);
  if (!aChange(plan)) throw new Error("Rien à publier : l'extrait publié est déjà à jour.");
  const depot = await etatDepot(id);
  if (depot.en_retard) throw new Error("Le dépôt des extraits est en retard sur GitHub : fais un « git pull » dans extraits/.");

  ctx.progression(0.2, "Écriture des fichiers");
  const dossier = dossierExtraitPublie(id);
  await mkdir(dossier, { recursive: true });
  for (const f of plan.json) if (f.etat !== "inchange") await writeFile(join(dossier, f.nom), f.contenu, "utf8");
  await envoyerMedias(
    id,
    plan.medias.filter((m) => m.etat !== "inchange").map((m) => ({ source: m.source, nom: FICHIERS_MEDIAS[m.media] })),
  );
  await regenererCatalogue();

  ctx.progression(0.5, "Commit");
  const chemins = [`extraits/${id}`, "catalogue.json"];
  await git(["add", "-A", "--", ...chemins]);
  await git(["commit", "-m", message.trim(), "--", ...chemins], { signal: ctx.signal });
  const commit = (await git(["rev-parse", "--short", "HEAD"])).stdout.trim();

  await modifierProjet(id, (p) => {
    p.publication = { version_medias: plan.version_medias, le: new Date().toISOString(), commit };
  });

  if (pousser) {
    ctx.progression(0.7, "Envoi vers GitHub (git push)");
    const amont = await git(["rev-parse", "--abbrev-ref", "@{u}"]).catch(() => null);
    await git(amont ? ["push"] : ["push", "-u", "origin", "HEAD"], { signal: ctx.signal });
    attendreDeploiement(id, plan.version_medias);
  }
  return commit;
}

export function lancerPublication(id: string, message: string, pousser: boolean): Tache {
  if (!message.trim()) throw new ErreurHttp(400, "Message de commit vide.");
  return lancerTache({ projet: id, type: "publication", libelle: "Publication" }, (ctx) =>
    unParUn(async () => {
      const commit = await executerPublication(id, message, pousser, ctx);
      ctx.terminer(pousser ? `Commit ${commit} poussé sur GitHub.` : `Commit ${commit} créé (pas encore poussé).`);
    }),
  );
}

/** Surveille l'adresse publique jusqu'à ce que Cloudflare Pages serve la nouvelle version. */
function attendreDeploiement(id: string, version: number): void {
  const url = `${config.urlExtraits}/extraits/${id}/info.json`;
  lancerTache({ projet: id, type: "deploiement", libelle: "Déploiement Cloudflare" }, async (ctx) => {
    const attendu = await readFile(join(dossierExtraitPublie(id), "info.json"), "utf8");
    const limite = Date.now() + 4 * 60_000;
    while (Date.now() < limite) {
      ctx.progression(null, `En attente de ${url}`);
      try {
        const reponse = await fetch(`${url}?verification=${Date.now()}`, { signal: AbortSignal.timeout(10_000) });
        if (reponse.ok && JSON.stringify(await reponse.json()) === JSON.stringify(JSON.parse(attendu))) {
          ctx.terminer(`En ligne (version des médias ${version}) : ${url}`);
          return;
        }
      } catch {
        // pas encore déployé, ou pas de réseau
      }
      await new Promise((r) => setTimeout(r, 10_000));
      if (ctx.signal.aborted) return;
    }
    throw new Error(`Pas encore visible sur ${url} après 4 minutes. Vérifie le tableau de bord Cloudflare Pages.`);
  });
}
