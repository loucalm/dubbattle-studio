// Le projet ouvert : son état complet, rechargé à chaque changement annoncé par le serveur.

import { api } from "./api.ts";
import { studio } from "./studio.svelte.ts";
import type { DetailProjet, ModificationProjet } from "../../../commun/types.ts";

export class ProjetOuvert {
  detail = $state<DetailProjet | null>(null);
  erreur = $state<string | null>(null);
  /** message affiché brièvement après une action */
  notification = $state<{ texte: string; niveau: "ok" | "erreur" } | null>(null);
  private minuterie: ReturnType<typeof setTimeout> | null = null;
  private minuterieNotification: ReturnType<typeof setTimeout> | null = null;
  private desabonner: () => void;

  constructor(readonly id: string) {
    this.desabonner = studio.surProjet((idChange) => {
      if (idChange === null || idChange === this.id) this.rechargerBientot();
    });
    void this.recharger();
  }

  get projet() {
    return this.detail?.projet ?? null;
  }

  async recharger(): Promise<void> {
    try {
      this.detail = await api.projet(this.id);
      this.erreur = null;
    } catch (e) {
      this.erreur = (e as Error).message;
    }
  }

  /** Plusieurs changements rapprochés (tâche qui avance) : un seul rechargement. */
  rechargerBientot(): void {
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = setTimeout(() => void this.recharger(), 120);
  }

  async modifier(m: ModificationProjet): Promise<boolean> {
    try {
      await api.modifier(this.id, m);
      await this.recharger();
      return true;
    } catch (e) {
      this.notifier((e as Error).message, "erreur");
      return false;
    }
  }

  /** Lance une action serveur en affichant son erreur éventuelle. */
  async action<T>(f: () => Promise<T>, succes?: string): Promise<T | null> {
    try {
      const r = await f();
      if (succes) this.notifier(succes, "ok");
      return r;
    } catch (e) {
      this.notifier((e as Error).message, "erreur");
      return null;
    }
  }

  notifier(texte: string, niveau: "ok" | "erreur"): void {
    this.notification = { texte, niveau };
    if (this.minuterieNotification) clearTimeout(this.minuterieNotification);
    this.minuterieNotification = setTimeout(() => (this.notification = null), niveau === "erreur" ? 8000 : 3000);
  }

  fermer(): void {
    this.desabonner();
    if (this.minuterie) clearTimeout(this.minuterie);
  }
}
