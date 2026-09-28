<script lang="ts">
  // Supprimer un extrait dont on ne veut plus : son projet de travail, et/ou son retrait du jeu
  // (dépôt des extraits et catalogue, puis commit et push).
  import Modale from "./Modale.svelte";
  import { api } from "../lib/api.ts";

  let {
    id,
    titre,
    projet,
    publie,
    onfermer,
    onfini,
  }: {
    id: string;
    titre: string;
    /** un projet existe dans l'espace de travail */
    projet: boolean;
    /** l'extrait est dans le dépôt des extraits */
    publie: boolean;
    onfermer: () => void;
    /** appelé après la suppression, avec ce qui a été fait */
    onfini: (fait: { projet: boolean; retrait: boolean }) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let supprimerProjet = $state(projet);
  // svelte-ignore state_referenced_locally
  let retirer = $state(publie && !projet);
  let pousser = $state(true);
  let enCours = $state(false);
  let erreur = $state<string | null>(null);

  async function confirmer() {
    enCours = true;
    erreur = null;
    try {
      if (retirer) await api.retirer(id, pousser);
      if (supprimerProjet) await api.supprimer(id);
      onfini({ projet: supprimerProjet, retrait: retirer });
    } catch (e) {
      erreur = (e as Error).message;
    } finally {
      enCours = false;
    }
  }
</script>

<Modale titre="Supprimer « {titre || id} »" {onfermer}>
  {#if projet}
    <label class="case choix">
      <input type="checkbox" bind:checked={supprimerProjet} />
      <span>
        <strong>Supprimer le projet</strong>
        <span class="discret petit">
          Efface l'espace de travail : séparations, pistes importées, aperçus, encodages. La vidéo source n'est pas
          touchée.
        </span>
      </span>
    </label>
  {/if}
  {#if publie}
    <label class="case choix">
      <input type="checkbox" bind:checked={retirer} />
      <span>
        <strong>Retirer l'extrait du jeu</strong>
        <span class="discret petit">
          Supprime <code>extraits/{id}</code> du dépôt des extraits et du catalogue (commit « Retrait de {id} »). Les parties
          en cours gardent la version déjà chargée. L'historique git garde les fichiers : on pourra le republier.
        </span>
      </span>
    </label>
    {#if retirer}
      <label class="case pousser petit">
        <input type="checkbox" bind:checked={pousser} />
        <span>Pousser vers GitHub (Cloudflare le retire alors du site)</span>
      </label>
    {/if}
  {/if}
  {#if projet && publie && supprimerProjet && !retirer}
    <p class="message info">
      L'extrait reste dans le jeu. On pourra le rouvrir pour le modifier depuis la bibliothèque (« Publiés »).
    </p>
  {/if}
  {#if erreur}<p class="message erreur">{erreur}</p>{/if}
  {#snippet pied()}
    <button onclick={onfermer}>Annuler</button>
    <button class="danger" disabled={(!supprimerProjet && !retirer) || enCours} onclick={confirmer}>
      {enCours ? "Suppression…" : "Supprimer"}
    </button>
  {/snippet}
</Modale>

<style>
  .choix {
    align-items: flex-start;
  }
  .choix input {
    margin-top: 3px;
  }
  .choix span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .pousser {
    margin-left: 24px;
  }
</style>
