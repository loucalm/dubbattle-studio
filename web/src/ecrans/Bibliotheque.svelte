<script lang="ts">
  // Écran d'accueil : nouveaux extraits, projets en cours, extraits publiés (fiche 7.6).
  import { onMount } from "svelte";
  import NouvelExtrait from "../composants/NouvelExtrait.svelte";
  import Reglages from "../composants/Reglages.svelte";
  import { api } from "../lib/api.ts";
  import { dateLisible } from "../lib/outils.ts";
  import { studio } from "../lib/studio.svelte.ts";
  import { formaterDuree } from "../../../commun/temps.ts";
  import type { Bibliotheque } from "../../../commun/types.ts";

  let biblio = $state<Bibliotheque | null>(null);
  let erreur = $state<string | null>(null);
  let reglages = $state(false);
  let ouverture = $state<string | null>(null);

  async function charger() {
    try {
      biblio = await api.bibliotheque();
      erreur = null;
    } catch (e) {
      erreur = (e as Error).message;
    }
  }

  onMount(() => {
    void charger();
    return studio.surBibliotheque(() => void charger());
  });

  async function ouvrirPublie(id: string) {
    ouverture = id;
    try {
      await api.ouvrirPublie(id);
      studio.aller({ ecran: "projet", id, etape: "repliques" });
    } catch (e) {
      erreur = (e as Error).message;
    } finally {
      ouverture = null;
    }
  }

  const o = $derived(studio.serveur?.outils);
  const sansProjet = $derived((biblio?.publies ?? []).filter((p) => !p.projet));
  const pret = $derived(!!o?.ffmpeg && !!o?.git);
</script>

<div class="page">
  <header class="ligne">
    <div class="logo">
      <span class="titre">Studio</span>
      <span class="sous-titre">Dub-Battle</span>
    </div>
    <span class="espaceur"></span>
    {#if o}
      <span class="pastille" class:ok={!!o.ffmpeg} class:erreur={!o.ffmpeg}>ffmpeg</span>
      <span class="pastille" class:ok={!!o.audio_separator} class:erreur={!o.audio_separator}>séparation</span>
      <span class="pastille" class:ok={!!o.faster_whisper} class:attention={!o.faster_whisper}>Whisper</span>
      <span class="pastille" class:ok={o.cuda}>{o.cuda ? "GPU" : "sans GPU"}</span>
      <span class="pastille" class:ok={!!o.git} class:erreur={!o.git}>git</span>
    {/if}
    <button onclick={() => (reglages = true)}>Réglages</button>
  </header>

  {#if studio.serveur && !studio.serveur.extraits_present}
    <p class="message erreur">
      Dépôt des extraits introuvable ({studio.serveur.dossiers.extraits}) : clone <code>dubbattle-extraits</code> à côté
      du Studio, ou règle <code>DOSSIER_EXTRAITS</code> dans <code>studio/.env</code>.
    </p>
  {/if}
  {#if !pret && o}
    <p class="message attention">Des outils manquent (voir Réglages) : le Studio ne pourra pas tout faire.</p>
  {/if}
  {#if erreur}<p class="message erreur">{erreur}</p>{/if}

  <section class="pile">
    <h2>Nouvel extrait</h2>
    <NouvelExtrait />
  </section>

  <section class="pile">
    <h2>En cours <span class="discret">{biblio?.projets.length ?? ""}</span></h2>
    {#if biblio && biblio.projets.length === 0}
      <p class="discret">Aucun projet dans l'espace de travail.</p>
    {/if}
    <div class="grille">
      {#each biblio?.projets ?? [] as p (p.id)}
        <button class="carte" onclick={() => studio.aller({ ecran: "projet", id: p.id, etape: p.duree_ms ? "repliques" : "import" })}>
          <img src={api.urlMedia(p.id, "sortie-vignette")} alt="" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")} />
          <div class="texte">
            <strong>{p.titre || p.id}</strong>
            <span class="mono discret petit">{p.id}</span>
            <span class="discret petit">{p.source_nom}</span>
            <div class="ligne petit">
              {#if p.duree_ms}<span>{formaterDuree(p.duree_ms)}</span>{/if}
              {#if p.publication}
                <span class="pastille ok">Publié · v{p.publication.version_medias}</span>
              {:else}
                <span class="pastille">Jamais publié</span>
              {/if}
              <span class="espaceur"></span>
              <span class="discret">{dateLisible(p.modifie_le)}</span>
            </div>
          </div>
        </button>
      {/each}
    </div>
  </section>

  {#if sansProjet.length > 0}
    <section class="pile">
      <h2>Publiés <span class="discret">{sansProjet.length}</span></h2>
      <p class="discret petit">
        Extraits du dépôt sans projet sur cette machine. Les ouvrir recrée un projet depuis leur
        <code>fabrication.json</code> : répliques et infos modifiables tout de suite, le reste dès que la source est retrouvée.
      </p>
      <table>
        <tbody>
          {#each sansProjet as e (e.id)}
            <tr>
              <td><strong>{e.titre}</strong> <span class="mono discret petit">{e.id}</span></td>
              <td class="discret">{formaterDuree(e.duree_ms)}</td>
              <td class="discret">v{e.version_medias}</td>
              <td style="text-align:right">
                <button class="petit" disabled={ouverture !== null} onclick={() => ouvrirPublie(e.id)}>
                  {ouverture === e.id ? "Ouverture…" : "Ouvrir pour modifier"}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}
</div>

{#if reglages}<Reglages onfermer={() => (reglages = false)} />{/if}

<style>
  .page {
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px 24px 120px;
    display: flex;
    flex-direction: column;
    gap: 26px;
  }
  .logo {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .titre {
    font-size: 24px;
    font-weight: 700;
    color: var(--or);
    letter-spacing: 0.04em;
  }
  .sous-titre {
    color: var(--texte-2);
    font-size: 15px;
  }
  .grille {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 12px;
  }
  .carte {
    display: flex;
    gap: 12px;
    align-items: stretch;
    text-align: left;
    padding: 10px;
    background: var(--panneau);
    border: 1px solid var(--bordure);
    border-radius: var(--rayon);
    white-space: normal;
  }
  .carte:hover {
    border-color: var(--or-sombre);
  }
  .carte img {
    width: 120px;
    height: 68px;
    object-fit: cover;
    border-radius: 4px;
    background: var(--fond-2);
    flex-shrink: 0;
  }
  .texte {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .texte > * {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
