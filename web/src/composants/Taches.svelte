<script lang="ts">
  // Tâches de fond, en bas à droite : en cours, et celles qui viennent de finir.
  import { api } from "../lib/api.ts";
  import { studio } from "../lib/studio.svelte.ts";
  import BarreTache from "./BarreTache.svelte";

  let masquees = $state(new Set<string>());
  const RECENT_MS = 12_000;
  let maintenant = $state(Date.now());

  $effect(() => {
    const t = setInterval(() => (maintenant = Date.now()), 2000);
    return () => clearInterval(t);
  });

  const visibles = $derived(
    studio.taches
      .filter((t) => !masquees.has(t.id))
      .filter(
        (t) =>
          t.etat === "attente" ||
          t.etat === "en_cours" ||
          t.etat === "erreur" ||
          (t.fin_le !== null && maintenant - Date.parse(t.fin_le) < RECENT_MS),
      )
      .sort((a, b) => a.cree_le.localeCompare(b.cree_le)),
  );

  function masquer(id: string) {
    masquees = new Set([...masquees, id]);
  }
</script>

{#if visibles.length > 0}
  <aside class="taches">
    {#each visibles as t (t.id)}
      <div class="tache {t.etat}">
        <div class="ligne entete">
          <strong class="libelle">{t.libelle}</strong>
          {#if t.projet}<span class="discret petit mono">{t.projet}</span>{/if}
          <span class="espaceur"></span>
          {#if t.etat === "attente" || t.etat === "en_cours"}
            <button class="discret petit" onclick={() => api.annulerTache(t.id)}>Annuler</button>
          {:else}
            <button class="discret petit" onclick={() => masquer(t.id)} aria-label="Masquer">✕</button>
          {/if}
        </div>
        <BarreTache tache={t} />
      </div>
    {/each}
  </aside>
{/if}

<style>
  .taches {
    position: fixed;
    right: 16px;
    bottom: 16px;
    width: 380px;
    max-height: 60vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 30;
  }
  .tache {
    background: var(--panneau);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--rayon);
    padding: 10px 12px;
    box-shadow: var(--ombre);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tache.erreur {
    border-color: rgba(224, 106, 94, 0.6);
  }
  .tache.ok {
    border-color: rgba(114, 179, 107, 0.5);
  }
  .libelle {
    font-size: 13px;
  }
  .entete {
    flex-wrap: nowrap;
  }
</style>
