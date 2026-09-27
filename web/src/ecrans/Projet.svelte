<script lang="ts">
  // Un projet ouvert : les 8 étapes du workflow (fiche 7.4) dans une colonne à gauche.
  import { onDestroy } from "svelte";
  import { ProjetOuvert } from "../lib/projet.svelte.ts";
  import { ETAPES, studio, type Etape } from "../lib/studio.svelte.ts";
  import { problemesRepliques } from "../../../commun/repliques.ts";
  import { dureeExtrait } from "../../../commun/publication.ts";
  import { formaterDuree } from "../../../commun/temps.ts";
  import Import from "../etapes/Import.svelte";
  import Decoupe from "../etapes/Decoupe.svelte";
  import Separation from "../etapes/Separation.svelte";
  import Repliques from "../etapes/Repliques.svelte";
  import Infos from "../etapes/Infos.svelte";
  import Encodage from "../etapes/Encodage.svelte";
  import Controle from "../etapes/Controle.svelte";
  import Publication from "../etapes/Publication.svelte";

  let { id, etape }: { id: string; etape: Etape } = $props();

  // svelte-ignore state_referenced_locally
  const ouvert = new ProjetOuvert(id);
  onDestroy(() => ouvert.fermer());

  type Statut = "fait" | "attention" | "a_faire" | "en_cours";

  const statuts = $derived.by((): Record<Etape, Statut> => {
    const d = ouvert.detail;
    const s: Record<Etape, Statut> = {
      import: "a_faire",
      decoupe: "a_faire",
      separation: "a_faire",
      repliques: "a_faire",
      infos: "a_faire",
      encodage: "a_faire",
      controle: "a_faire",
      publication: "a_faire",
    };
    if (!d) return s;
    const p = d.projet;
    const actives = (type: Parameters<typeof studio.tacheActive>[1]) => !!studio.tacheActive(id, type);
    s.import = !d.source_presente ? "attention" : p.source.empreinte ? "fait" : "en_cours";
    s.decoupe = p.decoupe ? "fait" : "a_faire";
    s.separation = actives("separation") ? "en_cours" : p.voice && p.bed && p.gain_db !== null ? "fait" : "a_faire";
    if (p.repliques.length > 0) {
      s.repliques = problemesRepliques(p.repliques, dureeExtrait(p), p.personnages).some((x) => x.grave) ? "attention" : "fait";
    }
    s.infos = p.infos.titre.trim() && p.infos.categorie.trim() ? "fait" : "a_faire";
    const etats = Object.values(d.etats_medias).map((e) => e.etat);
    s.encodage = actives("encodage")
      ? "en_cours"
      : etats.every((e) => e === "a_jour" || e === "images_cles")
        ? "fait"
        : etats.some((e) => e === "a_refaire")
          ? "attention"
          : "a_faire";
    s.controle = s.encodage === "fait" && s.repliques === "fait" && s.infos === "fait" ? "fait" : "a_faire";
    s.publication = actives("publication") ? "en_cours" : p.publication ? "fait" : "a_faire";
    return s;
  });

  const projet = $derived(ouvert.projet);
</script>

<div class="projet">
  <nav class="colonne">
    <button class="discret retour" onclick={() => studio.aller({ ecran: "bibliotheque" })}>← Bibliothèque</button>
    {#if projet}
      <div class="identite">
        <strong>{projet.infos.titre || projet.id}</strong>
        <span class="mono discret petit">{projet.id}</span>
        <div class="ligne petit">
          {#if projet.decoupe}<span class="discret">{formaterDuree(dureeExtrait(projet))}</span>{/if}
          {#if projet.publication}<span class="pastille ok">Publié · v{projet.publication.version_medias}</span>{/if}
        </div>
      </div>
    {/if}
    <ol class="etapes">
      {#each ETAPES as e (e.id)}
        <li>
          <button
            class="etape discret"
            class:courante={e.id === etape}
            onclick={() => studio.aller({ ecran: "projet", id, etape: e.id })}
          >
            <span class="numero {statuts[e.id]}">
              {#if statuts[e.id] === "fait"}✓{:else if statuts[e.id] === "attention"}!{:else}{e.numero}{/if}
            </span>
            <span>{e.titre}</span>
          </button>
        </li>
      {/each}
    </ol>
  </nav>

  <main>
    {#if ouvert.erreur && !ouvert.detail}
      <p class="message erreur">{ouvert.erreur}</p>
    {:else if ouvert.detail}
      {#key etape}
        {#if etape === "import"}<Import {ouvert} />
        {:else if etape === "decoupe"}<Decoupe {ouvert} />
        {:else if etape === "separation"}<Separation {ouvert} />
        {:else if etape === "repliques"}<Repliques {ouvert} />
        {:else if etape === "infos"}<Infos {ouvert} />
        {:else if etape === "encodage"}<Encodage {ouvert} />
        {:else if etape === "controle"}<Controle {ouvert} />
        {:else if etape === "publication"}<Publication {ouvert} />
        {/if}
      {/key}
    {:else}
      <p class="discret">Chargement…</p>
    {/if}
  </main>
</div>

{#if ouvert.notification}
  <div class="notification {ouvert.notification.niveau}">{ouvert.notification.texte}</div>
{/if}

<style>
  .projet {
    display: grid;
    grid-template-columns: 220px 1fr;
    min-height: 100vh;
  }
  .colonne {
    border-right: 1px solid var(--bordure);
    background: var(--fond-2);
    padding: 14px 10px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    position: sticky;
    top: 0;
    height: 100vh;
  }
  .retour {
    justify-content: flex-start;
  }
  .identite {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 0 8px;
    word-break: break-word;
  }
  .etapes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .etape {
    width: 100%;
    justify-content: flex-start;
    gap: 10px;
    padding: 7px 8px;
    color: var(--texte-2);
  }
  .etape.courante {
    background: var(--panneau-2);
    color: var(--texte);
    border-color: var(--bordure-forte);
  }
  .numero {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 11.5px;
    font-weight: 600;
    border: 1px solid var(--bordure-forte);
    color: var(--texte-3);
    flex-shrink: 0;
  }
  .numero.fait {
    background: rgba(114, 179, 107, 0.15);
    border-color: var(--ok);
    color: var(--ok);
  }
  .numero.attention {
    background: rgba(224, 169, 62, 0.15);
    border-color: var(--attention);
    color: var(--attention);
  }
  .numero.en_cours {
    border-color: var(--or);
    color: var(--or);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 4px rgba(212, 173, 90, 0.18);
    }
  }
  main {
    padding: 20px 24px 140px;
    min-width: 0;
  }
  .notification {
    position: fixed;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 16px;
    border-radius: var(--rayon);
    background: var(--panneau-2);
    border: 1px solid var(--bordure-forte);
    box-shadow: var(--ombre);
    z-index: 45;
    max-width: 70vw;
    white-space: pre-wrap;
  }
  .notification.erreur {
    border-color: var(--erreur);
    color: var(--erreur);
  }
  .notification.ok {
    border-color: var(--ok);
    color: var(--ok);
  }
</style>
