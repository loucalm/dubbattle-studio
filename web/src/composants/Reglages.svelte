<script lang="ts">
  import { onMount } from "svelte";
  import Explorateur from "./Explorateur.svelte";
  import Modale from "./Modale.svelte";
  import { api } from "../lib/api.ts";
  import { studio } from "../lib/studio.svelte.ts";

  let { onfermer }: { onfermer: () => void } = $props();

  let dossiers = $state<string[]>([]);
  let choix = $state(false);
  let erreur = $state<string | null>(null);

  onMount(async () => {
    dossiers = (await api.reglages()).dossiers_sources;
  });

  async function enregistrer(liste: string[]) {
    try {
      dossiers = (await api.ecrireReglages({ dossiers_sources: liste })).dossiers_sources;
      erreur = null;
    } catch (e) {
      erreur = (e as Error).message;
    }
  }

  const o = $derived(studio.serveur?.outils);
</script>

<Modale titre="Réglages" {onfermer}>
  <section class="pile">
    <h3>Dossiers des vidéos sources</h3>
    <p class="discret petit">
      Les vidéos sources restent où elles sont (disque externe…). Le Studio cherche dans ces dossiers pour retrouver un
      fichier glissé dans la fenêtre, ou une source déplacée ou renommée (grâce à son empreinte).
    </p>
    {#each dossiers as d (d)}
      <div class="ligne">
        <code class="dossier">{d}</code>
        <button class="discret petit" onclick={() => enregistrer(dossiers.filter((x) => x !== d))}>Retirer</button>
      </div>
    {:else}
      <p class="discret petit">Aucun dossier pour l'instant.</p>
    {/each}
    <div><button onclick={() => (choix = true)}>Ajouter un dossier…</button></div>
    {#if erreur}<p class="message erreur">{erreur}</p>{/if}
  </section>

  <section class="pile">
    <h3>Outils</h3>
    {#if o}
      <table>
        <tbody>
          <tr><td>ffmpeg</td><td class:ok={!!o.ffmpeg} class:erreur={!o.ffmpeg}>{o.ffmpeg ?? "absent"}</td></tr>
          <tr><td>Encodeur NVIDIA (aperçus)</td><td class:ok={o.nvenc}>{o.nvenc ? "oui" : "non (processeur)"}</td></tr>
          <tr><td>Python (studio/.venv)</td><td class:ok={!!o.python} class:erreur={!o.python}>{o.python ?? "absent : npm run python:installer"}</td></tr>
          <tr><td>audio-separator (Demucs, UVR)</td><td class:ok={!!o.audio_separator} class:erreur={!o.audio_separator}>{o.audio_separator ?? "absent"}</td></tr>
          <tr><td>faster-whisper</td><td class:ok={!!o.faster_whisper} class:attention={!o.faster_whisper}>{o.faster_whisper ?? "absent"}</td></tr>
          <tr><td>GPU CUDA</td><td class:ok={o.cuda}>{o.cuda ? "oui" : "non (plus lent)"}</td></tr>
          <tr><td>git</td><td class:ok={!!o.git} class:erreur={!o.git}>{o.git ?? "absent"}</td></tr>
        </tbody>
      </table>
      <div><button class="petit" onclick={() => studio.chargerEtat(true)}>Revérifier</button></div>
    {/if}
  </section>

  {#if studio.serveur}
    <section class="pile petit">
      <h3>Emplacements</h3>
      <div>Dépôt des extraits : <code>{studio.serveur.dossiers.extraits}</code></div>
      <div>Espace de travail : <code>{studio.serveur.dossiers.espace}</code></div>
      <div>Modèles d'IA : <code>{studio.serveur.dossiers.modeles}</code></div>
      <p class="discret">Modifiables dans <code>studio/.env</code> (voir <code>.env.example</code>).</p>
    </section>
  {/if}
</Modale>

{#if choix}
  <Explorateur
    titre="Ajouter un dossier de sources"
    mode="dossier"
    onfermer={() => (choix = false)}
    onchoisir={(c) => {
      choix = false;
      void enregistrer([...dossiers, c]);
    }}
  />
{/if}

<style>
  .dossier {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  td:first-child {
    color: var(--texte-2);
  }
</style>
