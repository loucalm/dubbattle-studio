<script lang="ts">
  // Vidéo source depuis une adresse YouTube (ou un autre site lu par yt-dlp) : aperçu, choix de
  // toute la vidéo ou d'un passage, téléchargement dans studio-workspace/_sources/. La fin du
  // téléchargement est suivie par le parent (NouvelExtrait), même si cette fenêtre est fermée.
  import BarreTache from "./BarreTache.svelte";
  import ChampTemps from "./ChampTemps.svelte";
  import Modale from "./Modale.svelte";
  import { api } from "../lib/api.ts";
  import { studio } from "../lib/studio.svelte.ts";
  import { formaterDuree } from "../../../commun/temps.ts";
  import type { InfosVideoEnLigne } from "../../../commun/types.ts";

  let {
    adresse,
    onfermer,
    onlance,
    onfini,
  }: {
    adresse: string;
    onfermer: () => void;
    onlance: (tache: string, titre: string) => void;
    onfini: (chemin: string, titre: string) => void;
  } = $props();

  let infos = $state<InfosVideoEnLigne | null>(null);
  let erreur = $state<string | null>(null);
  let passageSeul = $state(false);
  let debut = $state(0);
  let fin = $state(0);
  let tacheId = $state<string | null>(null);
  let lancement = $state(false);

  const tache = $derived(tacheId ? studio.taches.find((t) => t.id === tacheId) : undefined);
  const enCours = $derived(tache?.etat === "attente" || tache?.etat === "en_cours");
  const passageValide = $derived(fin > debut && (!infos?.duree_ms || debut < infos.duree_ms));

  $effect(() => {
    const a = adresse;
    infos = null;
    erreur = null;
    api.infosEnLigne(a).then(
      (i) => {
        infos = i;
        fin = Math.min(i.duree_ms ?? 60_000, 60_000);
      },
      (e) => (erreur = (e as Error).message),
    );
  });

  async function telecharger() {
    if (!infos || lancement) return;
    erreur = null;
    lancement = true;
    try {
      const t = await api.telecharger({
        adresse: infos.adresse,
        id: infos.id,
        titre: infos.titre,
        passage: passageSeul ? { debut_ms: debut, fin_ms: fin } : null,
      });
      tacheId = t.id;
      onlance(t.id, infos.titre);
    } catch (e) {
      erreur = (e as Error).message;
    } finally {
      lancement = false;
    }
  }
</script>

<Modale titre="Vidéo en ligne" {onfermer}>
  <div class="pile">
    {#if !infos && !erreur}
      <p class="discret">Lecture de l'adresse…</p>
    {/if}
    {#if infos}
      <div class="ligne apercu">
        {#if infos.vignette}<img src={infos.vignette} alt="" referrerpolicy="no-referrer" />{/if}
        <div class="pile serre">
          <strong>{infos.titre}</strong>
          <span class="discret petit">
            {[infos.chaine, infos.site, infos.duree_ms ? formaterDuree(infos.duree_ms) : null, infos.hauteur ? `${infos.hauteur}p` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </div>

      {#if infos.deja}
        <div class="message info pile">
          <span>Déjà téléchargée : <code class="chemin">{infos.deja}</code></span>
          <div><button class="principal" onclick={() => onfini(infos!.deja!, infos!.titre)}>Utiliser ce fichier</button></div>
        </div>
      {/if}

      <fieldset class="pile serre" disabled={!!tache}>
        <label class="case">
          <input type="radio" bind:group={passageSeul} value={false} />
          <span>Toute la vidéo <span class="discret petit">(jusqu'en 1080p, H.264 si possible)</span></span>
        </label>
        <label class="case">
          <input type="radio" bind:group={passageSeul} value={true} />
          <span>Seulement un passage <span class="discret petit">(plus rapide pour une longue vidéo)</span></span>
        </label>
        {#if passageSeul}
          <div class="ligne passage">
            <span class="petit">De</span>
            <ChampTemps valeur={debut} onchange={(ms) => (debut = ms)} heures etiquette="Début du passage" />
            <span class="petit">à</span>
            <ChampTemps valeur={fin} onchange={(ms) => (fin = ms)} heures etiquette="Fin du passage" />
          </div>
          <p class="discret petit">
            Prends large : le passage est coupé sur les images clés, sans réencodage, et la découpe fine se fait à
            l'étape 2.
          </p>
        {/if}
      </fieldset>
    {/if}

    {#if tache}<BarreTache {tache} />{/if}
    {#if erreur}<pre class="message erreur petit">{erreur}</pre>{/if}
    <p class="discret petit">
      Rangée dans <code>studio-workspace/_sources/</code>. Tu peux fermer cette fenêtre : le téléchargement continue
      (suivi en bas à droite).
    </p>
  </div>
  {#snippet pied()}
    {#if enCours && tache}
      <button onclick={() => api.annulerTache(tache.id)}>Annuler le téléchargement</button>
    {:else}
      <button onclick={onfermer}>Fermer</button>
    {/if}
    <button class="principal" disabled={!infos || !!tache || lancement || (passageSeul && !passageValide)} onclick={telecharger}>
      {enCours ? "Téléchargement…" : "Télécharger"}
    </button>
  {/snippet}
</Modale>

<style>
  .apercu {
    align-items: flex-start;
    flex-wrap: nowrap;
  }
  .apercu img {
    width: 160px;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 4px;
    background: var(--fond-2);
    flex-shrink: 0;
  }
  .serre {
    gap: 4px;
  }
  fieldset {
    border: none;
    padding: 0;
    margin: 0;
  }
  .passage {
    margin-left: 24px;
  }
  .chemin {
    word-break: break-all;
  }
  pre.message {
    white-space: pre-wrap;
    margin: 0;
  }
</style>
