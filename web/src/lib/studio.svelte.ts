// État global de l'interface : navigation, état du serveur, tâches en direct.

import { api } from "./api.ts";
import type { EtatServeur, Tache, TypeTache } from "../../../commun/types.ts";

export type Etape = "import" | "decoupe" | "separation" | "repliques" | "infos" | "encodage" | "controle" | "publication";

export const ETAPES: { id: Etape; numero: number; titre: string }[] = [
  { id: "import", numero: 1, titre: "Import" },
  { id: "decoupe", numero: 2, titre: "Découpe" },
  { id: "separation", numero: 3, titre: "Voix et fond" },
  { id: "repliques", numero: 4, titre: "Répliques" },
  { id: "infos", numero: 5, titre: "Infos" },
  { id: "encodage", numero: 6, titre: "Encodage" },
  { id: "controle", numero: 7, titre: "Contrôle" },
  { id: "publication", numero: 8, titre: "Publication" },
];

export type Route = { ecran: "bibliotheque" } | { ecran: "projet"; id: string; etape: Etape };

function lireRoute(): Route {
  const [ecran, id, etape] = location.hash.replace(/^#\/?/, "").split("/");
  if (ecran === "projet" && id) {
    const e = ETAPES.find((x) => x.id === etape)?.id ?? "import";
    return { ecran: "projet", id: decodeURIComponent(id), etape: e };
  }
  return { ecran: "bibliotheque" };
}

type Ecouteur = (id: string | null) => void;

class Studio {
  route = $state<Route>(lireRoute());
  serveur = $state<EtatServeur | null>(null);
  erreurServeur = $state<string | null>(null);
  taches = $state<Tache[]>([]);
  connecte = $state(false);
  private ecouteursProjet = new Set<Ecouteur>();
  private ecouteursBibliotheque = new Set<() => void>();

  constructor() {
    window.addEventListener("hashchange", () => (this.route = lireRoute()));
  }

  aller(route: Route): void {
    location.hash = route.ecran === "projet" ? `#/projet/${encodeURIComponent(route.id)}/${route.etape}` : "#/";
  }

  async demarrer(): Promise<void> {
    await this.chargerEtat();
    this.ecouter();
  }

  async chargerEtat(rafraichir = false): Promise<void> {
    try {
      this.serveur = await api.etat(rafraichir);
      this.taches = this.serveur.taches;
      this.erreurServeur = null;
    } catch (e) {
      this.erreurServeur = (e as Error).message;
    }
  }

  private ecouter(): void {
    const source = new EventSource("/api/evenements");
    source.onopen = () => {
      // après une coupure, on resynchronise tout
      if (!this.connecte) void this.chargerEtat();
      this.connecte = true;
      this.ecouteursProjet.forEach((f) => f(null));
      this.ecouteursBibliotheque.forEach((f) => f());
    };
    source.onerror = () => (this.connecte = false);
    source.addEventListener("tache", (e) => {
      const tache = JSON.parse((e as MessageEvent).data) as Tache;
      const i = this.taches.findIndex((t) => t.id === tache.id);
      if (i >= 0) this.taches[i] = tache;
      else this.taches.push(tache);
    });
    source.addEventListener("projet", (e) => {
      const { id } = JSON.parse((e as MessageEvent).data) as { id: string };
      this.ecouteursProjet.forEach((f) => f(id));
    });
    source.addEventListener("projets", () => this.ecouteursBibliotheque.forEach((f) => f()));
  }

  /** Appelé quand un projet change côté serveur (id null : tous, après une reconnexion). */
  surProjet(f: Ecouteur): () => void {
    this.ecouteursProjet.add(f);
    return () => this.ecouteursProjet.delete(f);
  }

  surBibliotheque(f: () => void): () => void {
    this.ecouteursBibliotheque.add(f);
    return () => this.ecouteursBibliotheque.delete(f);
  }

  tachesProjet(id: string, type?: TypeTache): Tache[] {
    return this.taches.filter((t) => t.projet === id && (!type || t.type === type));
  }

  tacheActive(id: string, type: TypeTache): Tache | undefined {
    return this.tachesProjet(id, type).find((t) => t.etat === "attente" || t.etat === "en_cours");
  }

  /** Dernière tâche de ce type pour ce projet (active ou terminée). */
  derniereTache(id: string, type: TypeTache): Tache | undefined {
    return this.tachesProjet(id, type).sort((a, b) => b.cree_le.localeCompare(a.cree_le))[0];
  }
}

export const studio = new Studio();
