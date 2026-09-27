<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    titre,
    onfermer,
    children,
    pied,
    large = false,
  }: { titre: string; onfermer: () => void; children: Snippet; pied?: Snippet; large?: boolean } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onfermer()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="voile" onmousedown={(e) => e.target === e.currentTarget && onfermer()}>
  <div class="modale" class:large role="dialog" aria-modal="true" aria-label={titre}>
    <header>
      <h2>{titre}</h2>
      <button class="discret" onclick={onfermer} aria-label="Fermer">✕</button>
    </header>
    <div class="corps">{@render children()}</div>
    {#if pied}<footer>{@render pied()}</footer>{/if}
  </div>
</div>

<style>
  .voile {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: grid;
    place-items: center;
    z-index: 40;
    padding: 24px;
  }
  .modale {
    background: var(--panneau);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--rayon);
    box-shadow: var(--ombre);
    width: min(560px, 100%);
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
  }
  .modale.large {
    width: min(860px, 100%);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--bordure);
  }
  .corps {
    padding: 16px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--bordure);
  }
</style>
