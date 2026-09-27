<script lang="ts">
  // Étape 5 : titre, source, catégorie, tags, langue, noms des personnages, image de la vignette.
  import { onMount } from "svelte";
  import EnteteEtape from "../composants/EnteteEtape.svelte";
  import { api } from "../lib/api.ts";
  import { couleurDe } from "../lib/outils.ts";
  import type { ProjetOuvert } from "../lib/projet.svelte.ts";
  import { dureeExtrait, personnagesPublies } from "../../../commun/publication.ts";
  import { formaterTemps } from "../../../commun/temps.ts";
  import type { Infos } from "../../../commun/types.ts";

  let { ouvert }: { ouvert: ProjetOuvert } = $props();

  const d = $derived(ouvert.detail!);
  const p = $derived(d.projet);
  const duree = $derived(dureeExtrait(p));

  // svelte-ignore state_referenced_locally
  let infos = $state<Infos>($state.snapshot(p.infos));
  // svelte-ignore state_referenced_locally
  let tags = $state(p.infos.tags.join(", "));
  let vocabulaire = $state<{ categories: string[]; tags: string[] }>({ categories: [], tags: [] });
  // svelte-ignore state_referenced_locally
  let vignette = $state(p.infos.vignette_ms);

  onMount(async () => {
    vocabulaire = await api.vocabulaire().catch(() => ({ categories: [], tags: [] }));
  });

  async function enregistrer() {
    const liste = [...new Set(tags.split(",").map((t) => t.trim()).filter(Boolean))];
    await ouvert.modifier({ infos: { ...$state.snapshot(infos), tags: liste, vignette_ms: vignette } });
  }

  const LANGUES = [
    ["fr", "Français"],
    ["en", "Anglais"],
    ["es", "Espagnol"],
    ["de", "Allemand"],
    ["it", "Italien"],
    ["ja", "Japonais"],
    ["pt", "Portugais"],
  ];

  const publies = $derived(personnagesPublies(p));
  const imageVignette = $derived(
    d.source_presente && p.decoupe
      ? api.urlImage(p.id, p.decoupe.entree_ms + vignette, 640)
      : p.sortie.vignette
        ? api.urlMedia(p.id, "sortie-vignette")
        : null,
  );
</script>

<EnteteEtape etape="infos" id={p.id} description="Ce qui s'affiche dans la sélection d'extraits du jeu. Le contenu reste dans sa langue d'origine." />

<div class="grille">
  <section class="panneau pile">
    <label class="champ">
      Titre
      <input bind:value={infos.titre} onchange={enregistrer} placeholder="La proue du Titanic" maxlength="100" />
    </label>
    <label class="champ">
      Source (œuvre d'origine)
      <input bind:value={infos.source} onchange={enregistrer} placeholder="Titanic (1997)" maxlength="150" />
    </label>
    <div class="ligne deux">
      <label class="champ">
        Catégorie
        <input bind:value={infos.categorie} onchange={enregistrer} list="categories" placeholder="Film" maxlength="40" />
        <datalist id="categories">
          {#each vocabulaire.categories as c (c)}<option value={c}></option>{/each}
        </datalist>
      </label>
      <label class="champ">
        Langue de l'extrait
        <select bind:value={infos.langue} onchange={enregistrer}>
          {#each LANGUES as [code, nom] (code)}<option value={code}>{nom}</option>{/each}
          {#if !LANGUES.some(([c]) => c === infos.langue)}<option value={infos.langue}>{infos.langue}</option>{/if}
        </select>
      </label>
    </div>
    <label class="champ">
      Tags (séparés par des virgules)
      <input bind:value={tags} onchange={enregistrer} placeholder="romance, culte" />
    </label>
    {#if vocabulaire.tags.length > 0}
      <div class="ligne petit">
        <span class="discret">Déjà utilisés :</span>
        {#each vocabulaire.tags as t (t)}
          <button
            class="discret petit"
            onclick={() => {
              const liste = tags.split(",").map((x) => x.trim()).filter(Boolean);
              if (!liste.includes(t)) {
                tags = [...liste, t].join(", ");
                void enregistrer();
              }
            }}>{t}</button
          >
        {/each}
      </div>
    {/if}

    <h3 class="espace-haut">Personnages</h3>
    {#if p.personnages.length === 0}
      <p class="discret petit">Les personnages se créent à l'étape 4, avec les répliques.</p>
    {/if}
    {#each p.personnages as perso (perso.id)}
      <div class="ligne">
        <span class="puce" style:--c={couleurDe(p.personnages, perso.id)}></span>
        <strong>{perso.nom}</strong>
        <span class="mono discret petit">{perso.id}</span>
        {#if !publies.some((x) => x.id === perso.id)}<span class="attention petit">sans réplique : ne sera pas publié</span>{/if}
      </div>
    {/each}
  </section>

  <section class="panneau pile">
    <h3>Vignette</h3>
    {#if imageVignette}
      <img class="vignette" src={imageVignette} alt="Vignette" />
    {:else}
      <div class="vignette vide discret petit">Vignette disponible quand la source est reliée.</div>
    {/if}
    {#if d.source_presente && p.decoupe}
      <input
        type="range"
        min="0"
        max={duree - 1}
        step="40"
        bind:value={vignette}
        onchange={enregistrer}
        aria-label="Instant de la vignette"
      />
      <div class="ligne petit">
        <span class="discret">Instant :</span>
        <span class="mono">{formaterTemps(vignette)}</span>
        <span class="discret">depuis le début de l'extrait</span>
      </div>
    {/if}
    <p class="discret petit">WebP 640 px de large, fabriqué à l'encodage (étape 6).</p>
  </section>
</div>

<style>
  .grille {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .deux > * {
    flex: 1;
  }
  .espace-haut {
    margin-top: 8px;
  }
  .puce {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--c);
  }
  .vignette {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: contain;
    background: #000;
    border-radius: var(--rayon-petit);
  }
  .vignette.vide {
    display: grid;
    place-items: center;
  }
  input[type="range"] {
    width: 100%;
  }
</style>
