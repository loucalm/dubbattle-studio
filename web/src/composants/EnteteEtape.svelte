<script lang="ts">
  import type { Snippet } from "svelte";
  import { ETAPES, studio, type Etape } from "../lib/studio.svelte.ts";

  let {
    etape,
    id,
    description,
    actions,
  }: { etape: Etape; id: string; description?: string; actions?: Snippet } = $props();

  const infos = $derived(ETAPES.find((e) => e.id === etape)!);
  const suivante = $derived(ETAPES.find((e) => e.numero === infos.numero + 1));
</script>

<header class="entete">
  <div class="titres">
    <h1><span class="numero">{infos.numero}</span> {infos.titre}</h1>
    {#if description}<p class="discret">{description}</p>{/if}
  </div>
  <div class="ligne">
    {#if actions}{@render actions()}{/if}
    {#if suivante}
      <button onclick={() => studio.aller({ ecran: "projet", id, etape: suivante.id })}>{suivante.titre} →</button>
    {/if}
  </div>
</header>

<style>
  .entete {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
  }
  .titres {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 760px;
  }
  .numero {
    color: var(--or);
    margin-right: 4px;
  }
</style>
