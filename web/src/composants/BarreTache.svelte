<script lang="ts">
  import type { Tache } from "../../../commun/types.ts";

  let { tache }: { tache: Tache } = $props();

  const pourcent = $derived(tache.progression === null ? null : Math.round(tache.progression * 100));
  const texte = $derived(
    tache.etat === "attente"
      ? "En attente (une autre tâche lourde est en cours)"
      : tache.etat === "annulee"
        ? "Annulée"
        : tache.etat === "ok"
          ? (tache.detail ?? "Terminé")
          : (tache.detail ?? (tache.etat === "en_cours" ? "En cours…" : "")),
  );
</script>

<div class="barre-tache">
  {#if tache.etat === "en_cours" || tache.etat === "attente"}
    <div class="piste" class:indeterminee={pourcent === null || tache.etat === "attente"}>
      <div class="remplissage" style:width={pourcent === null ? "35%" : `${pourcent}%`}></div>
    </div>
  {/if}
  {#if tache.etat === "erreur"}
    <pre class="erreur petit">{tache.erreur}</pre>
  {:else}
    <div class="ligne petit">
      <span class:ok={tache.etat === "ok"} class="discret texte">{tache.etat === "ok" ? "✓ " : ""}{texte}</span>
      <span class="espaceur"></span>
      {#if pourcent !== null && tache.etat === "en_cours"}<span class="mono discret">{pourcent} %</span>{/if}
    </div>
  {/if}
</div>

<style>
  .barre-tache {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .piste {
    height: 5px;
    border-radius: 3px;
    background: var(--panneau-2);
    overflow: hidden;
    position: relative;
  }
  .remplissage {
    height: 100%;
    background: var(--or);
    border-radius: 3px;
    transition: width 0.25s;
  }
  .indeterminee .remplissage {
    position: absolute;
    animation: va-et-vient 1.3s ease-in-out infinite;
  }
  @keyframes va-et-vient {
    0% {
      left: -35%;
    }
    100% {
      left: 100%;
    }
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--police-mono);
    max-height: 160px;
    overflow: auto;
  }
  .texte {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .texte.ok {
    color: var(--ok);
  }
</style>
