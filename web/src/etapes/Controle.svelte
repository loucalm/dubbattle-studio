<script lang="ts">
  // Étape 7 : vérifications automatiques, et « mode jeu » sur les fichiers encodés (ce que les
  // joueurs recevront) : vidéo + bed + voice synchronisés, réplique par réplique.
  import { onDestroy, onMount } from "svelte";
  import EnteteEtape from "../composants/EnteteEtape.svelte";
  import { api } from "../lib/api.ts";
  import { chargerTampon, Lecteur } from "../lib/lecteur.ts";
  import { couleurDe, dansUnChamp } from "../lib/outils.ts";
  import type { ProjetOuvert } from "../lib/projet.svelte.ts";
  import { dureeExtrait } from "../../../commun/publication.ts";
  import { trierRepliques } from "../../../commun/repliques.ts";
  import { formaterTemps } from "../../../commun/temps.ts";
  import type { Replique, ResultatControle } from "../../../commun/types.ts";

  let { ouvert }: { ouvert: ProjetOuvert } = $props();

  const d = $derived(ouvert.detail!);
  const p = $derived(d.projet);

  let resultats = $state<ResultatControle[] | null>(null);
  let verification = $state(false);

  async function verifier() {
    verification = true;
    resultats = await ouvert.action(() => api.controle(p.id));
    verification = false;
  }
  onMount(() => void verifier());

  // ---- mode jeu ----
  const lecteur = new Lecteur();
  let elementVideo = $state<HTMLVideoElement | null>(null);
  let position = $state(0);
  let enLecture = $state(false);
  let avecVoice = $state(true);
  let avecBed = $state(true);
  let courante = $state<number | null>(null);
  let pret = $state(false);
  let erreur = $state<string | null>(null);
  lecteur.surPosition = (ms) => {
    position = ms;
    enLecture = lecteur.enLecture;
  };
  lecteur.surFin = () => (enLecture = false);
  onDestroy(() => lecteur.detruire());

  const encodes = $derived(!!p.sortie.video && !!p.sortie.voice && !!p.sortie.bed);
  const urls = $derived(
    encodes
      ? {
          video: `${api.urlMedia(p.id, "sortie-video")}?v=${p.sortie.video!.empreinte}`,
          voice: `${api.urlMedia(p.id, "sortie-voice")}?v=${p.sortie.voice!.empreinte}`,
          bed: `${api.urlMedia(p.id, "sortie-bed")}?v=${p.sortie.bed!.empreinte}`,
        }
      : null,
  );

  $effect(() => {
    lecteur.attacherVideo(elementVideo, 0);
  });

  $effect(() => {
    if (!urls) return;
    pret = false;
    void Promise.all([chargerTampon(urls.voice), chargerTampon(urls.bed)])
      .then(([voice, bed]) => {
        lecteur.ajouterPiste("voice", voice, avecVoice ? 1 : 0);
        lecteur.ajouterPiste("bed", bed, avecBed ? 1 : 0);
        pret = true;
        erreur = null;
      })
      .catch((e: Error) => (erreur = e.message));
  });

  $effect(() => {
    lecteur.volume("voice", avecVoice ? 1 : 0);
    lecteur.volume("bed", avecBed ? 1 : 0);
  });

  const triees = $derived(trierRepliques(p.repliques));

  function lire(r: Replique) {
    courante = r.id;
    lecteur.jouer(r.debut_ms, r.fin_ms);
    enLecture = true;
  }

  function clavier(e: KeyboardEvent) {
    if (dansUnChamp(e) || !pret) return;
    const i = triees.findIndex((r) => r.id === courante);
    if (e.key === " ") {
      e.preventDefault();
      lecteur.basculer();
      enLecture = lecteur.enLecture;
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const r = triees[Math.max(0, Math.min(triees.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (r) lire(r);
    }
  }

  const icone = { ok: "✓", attention: "!", erreur: "✕" };
</script>

<svelte:window onkeydown={clavier} />

<EnteteEtape etape="controle" id={p.id} description="Vérifie les schémas JSON, les répliques, les médias (à jour, tailles, durées égales à ±20 ms) et écoute le résultat comme dans le jeu.">
  {#snippet actions()}
    <button onclick={verifier} disabled={verification}>{verification ? "Vérification…" : "Revérifier"}</button>
  {/snippet}
</EnteteEtape>

<div class="grille">
  <section class="pile">
    {#each resultats ?? [] as r (r.titre)}
      <div class="panneau resultat {r.niveau}">
        <div class="ligne">
          <span class="icone {r.niveau}">{icone[r.niveau]}</span>
          <h3>{r.titre}</h3>
        </div>
        {#each r.erreurs as t, i (i)}<p class="erreur petit">{t}</p>{/each}
        {#each r.attentions as t, i (i)}<p class="attention petit">{t}</p>{/each}
        {#each r.infos as t, i (i)}<p class="discret petit">{t}</p>{/each}
      </div>
    {/each}
  </section>

  <section class="panneau pile">
    <h2>Mode jeu</h2>
    {#if !urls}
      <p class="discret">Encode d'abord l'extrait (étape 6) pour l'écouter tel que les joueurs le recevront.</p>
    {:else}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={elementVideo} src={urls.video} preload="auto" muted></video>
      <div class="ligne">
        <button
          class="principal"
          disabled={!pret}
          onclick={() => {
            courante = null;
            lecteur.jouer(0);
            enLecture = true;
          }}>▶ Tout lire</button
        >
        <button
          disabled={!pret}
          onclick={() => {
            lecteur.basculer();
            enLecture = lecteur.enLecture;
          }}>{enLecture ? "❚❚" : "▶"}</button
        >
        <span class="mono">{formaterTemps(position)} / {formaterTemps(dureeExtrait(p))}</span>
        <span class="espaceur"></span>
        <label class="case petit"><input type="checkbox" bind:checked={avecVoice} /> Voice</label>
        <label class="case petit"><input type="checkbox" bind:checked={avecBed} /> Bed</label>
      </div>
      {#if erreur}<p class="erreur petit">{erreur}</p>{/if}
      <p class="discret petit">Coupe la voice pour entendre ce que le joueur aura sous son doublage. <kbd>↑</kbd> <kbd>↓</kbd> : réplique précédente / suivante.</p>
      <div class="repliques">
        {#each triees as r (r.id)}
          <button class="replique discret" class:actif={courante === r.id} disabled={!pret} onclick={() => lire(r)}>
            <span class="puce" style:--c={couleurDe(p.personnages, r.personnage)}></span>
            <span class="mono discret petit">{formaterTemps(r.debut_ms)}</span>
            <span class="texte">{r.texte}</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .grille {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .resultat {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
  }
  .resultat.erreur {
    border-color: rgba(224, 106, 94, 0.45);
  }
  .resultat.attention {
    border-color: rgba(224, 169, 62, 0.45);
  }
  .icone {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    border: 1px solid currentColor;
  }
  .icone.ok {
    color: var(--ok);
  }
  .icone.attention {
    color: var(--attention);
  }
  .icone.erreur {
    color: var(--erreur);
  }
  video {
    width: 100%;
    background: #000;
    border-radius: var(--rayon-petit);
  }
  .repliques {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 34vh;
    overflow: auto;
  }
  .replique {
    justify-content: flex-start;
    color: var(--texte);
    white-space: nowrap;
  }
  .replique.actif {
    background: var(--panneau-2);
    border-color: var(--or-sombre);
    color: var(--texte);
  }
  .puce {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--c);
    flex-shrink: 0;
  }
  .texte {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
