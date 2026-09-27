<script lang="ts">
  import { onMount } from "svelte";
  import { studio } from "./lib/studio.svelte.ts";
  import Bibliotheque from "./ecrans/Bibliotheque.svelte";
  import Projet from "./ecrans/Projet.svelte";
  import Taches from "./composants/Taches.svelte";

  onMount(() => void studio.demarrer());
</script>

{#if studio.erreurServeur && !studio.serveur}
  <div class="injoignable">
    <h1>Studio Dub-Battle</h1>
    <p class="erreur">{studio.erreurServeur}</p>
    <button onclick={() => studio.chargerEtat()}>Réessayer</button>
  </div>
{:else if studio.route.ecran === "projet"}
  {#key studio.route.id}
    <Projet id={studio.route.id} etape={studio.route.etape} />
  {/key}
{:else}
  <Bibliotheque />
{/if}

<Taches />

{#if studio.serveur && !studio.connecte}
  <div class="deconnecte">Connexion au serveur du Studio perdue… nouvelle tentative en cours.</div>
{/if}

<style>
  .injoignable {
    max-width: 520px;
    margin: 15vh auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    align-items: flex-start;
  }
  .deconnecte {
    position: fixed;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bordeaux);
    color: #fff;
    padding: 6px 16px;
    border-radius: 0 0 var(--rayon) var(--rayon);
    font-size: var(--taille-petite);
    z-index: 50;
  }
</style>
