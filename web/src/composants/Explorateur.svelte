<script lang="ts">
  // Choix d'un fichier vidéo ou d'un dossier sur la machine (via le serveur local).
  import { onMount } from "svelte";
  import Modale from "./Modale.svelte";
  import { api } from "../lib/api.ts";
  import { tailleLisible } from "../lib/outils.ts";
  import type { ContenuDossier } from "../../../commun/types.ts";

  let {
    titre = "Choisir une vidéo",
    mode = "fichier",
    onchoisir,
    onfermer,
  }: {
    titre?: string;
    mode?: "fichier" | "dossier";
    onchoisir: (chemin: string) => void;
    onfermer: () => void;
  } = $props();

  const CLE = "studio.explorateur.dossier";
  let contenu = $state<ContenuDossier | null>(null);
  let saisie = $state("");
  let erreur = $state<string | null>(null);
  let chargement = $state(false);

  async function ouvrir(chemin?: string) {
    chargement = true;
    try {
      contenu = await api.dossier(chemin);
      saisie = contenu.chemin ?? "";
      erreur = null;
      if (contenu.chemin) localStorage.setItem(CLE, contenu.chemin);
    } catch (e) {
      erreur = (e as Error).message;
    } finally {
      chargement = false;
    }
  }

  onMount(() => {
    let dernier: string | undefined;
    try {
      dernier = localStorage.getItem(CLE) ?? undefined;
    } catch {
      dernier = undefined;
    }
    void ouvrir(dernier).then(() => {
      if (erreur && dernier) void ouvrir();
    });
  });

  const entrees = $derived((contenu?.entrees ?? []).filter((e) => mode === "fichier" || e.dossier));
</script>

<Modale {titre} {onfermer} large>
  <form
    class="ligne"
    onsubmit={(e) => {
      e.preventDefault();
      void ouvrir(saisie.replace(/^"|"$/g, "").trim() || undefined);
    }}
  >
    <button type="button" onclick={() => ouvrir(contenu?.parent ?? undefined)} disabled={!contenu?.chemin} title="Dossier parent">
      ↑
    </button>
    <button type="button" onclick={() => ouvrir()} title="Lecteurs">Lecteurs</button>
    <input class="chemin" bind:value={saisie} placeholder="Chemin d'un dossier" spellcheck="false" />
    <button type="submit">Aller</button>
  </form>

  {#if erreur}<p class="message erreur">{erreur}</p>{/if}

  <div class="liste" class:chargement>
    {#each entrees as e (e.chemin)}
      <button class="entree discret" onclick={() => (e.dossier ? ouvrir(e.chemin) : onchoisir(e.chemin))}>
        <span class="icone">{e.dossier ? "📁" : "🎞️"}</span>
        <span class="nom">{e.nom}</span>
        <span class="discret petit">{tailleLisible(e.taille_octets)}</span>
      </button>
    {:else}
      <p class="discret petit vide">{mode === "fichier" ? "Aucune vidéo ni sous-dossier ici." : "Aucun sous-dossier."}</p>
    {/each}
  </div>

  {#snippet pied()}
    {#if mode === "dossier"}
      <button class="principal" disabled={!contenu?.chemin} onclick={() => contenu?.chemin && onchoisir(contenu.chemin)}>
        Choisir ce dossier
      </button>
    {/if}
    <button onclick={onfermer}>Annuler</button>
  {/snippet}
</Modale>

<style>
  .chemin {
    flex: 1;
    font-family: var(--police-mono);
    font-size: 12.5px;
  }
  .liste {
    display: flex;
    flex-direction: column;
    min-height: 320px;
    max-height: 55vh;
    overflow: auto;
    border: 1px solid var(--bordure);
    border-radius: var(--rayon-petit);
    background: var(--fond-2);
    padding: 4px;
  }
  .liste.chargement {
    opacity: 0.6;
  }
  .entree {
    justify-content: flex-start;
    border-radius: 4px;
    padding: 5px 8px;
    color: var(--texte);
  }
  .nom {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .icone {
    width: 22px;
  }
  .vide {
    padding: 12px;
  }
</style>
