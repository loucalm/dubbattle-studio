<script lang="ts">
  // Étape 2 : entrée et sortie à l'image près. Rien n'est encodé ici, la source reste intacte.
  import { onMount } from "svelte";
  import ChampTemps from "../composants/ChampTemps.svelte";
  import EnteteEtape from "../composants/EnteteEtape.svelte";
  import TimelineSource from "../composants/TimelineSource.svelte";
  import { api } from "../lib/api.ts";
  import { dansUnChamp } from "../lib/outils.ts";
  import type { ProjetOuvert } from "../lib/projet.svelte.ts";
  import { dureeImage, formaterDuree, formaterTemps } from "../../../commun/temps.ts";

  let { ouvert }: { ouvert: ProjetOuvert } = $props();

  const d = $derived(ouvert.detail!);
  const p = $derived(d.projet);
  const ips = $derived(p.source.video.ips);
  const decalage = $derived(p.source.video.decalage_ms);
  const dureeSource = $derived(p.source.duree_ms);
  // la découpe se fait sur la source ou son aperçu (même temps que ffmpeg), pas sur la vidéo encodée
  const video = $derived(d.lecture.video && !d.lecture.video.url.includes("/sortie-video") ? d.lecture.video : null);

  // ---- grille des images ----
  const imageA = (ms: number) => Math.floor(((ms - decalage) * ips) / 1000 + 1e-6);
  const debutImage = (k: number) => (k * 1000) / ips + decalage;
  /** Instant de l'image affichée à cette position (celle qui a commencé avant). */
  const imageAffichee = (ms: number) => debutImage(Math.max(0, imageA(ms)));
  /** Le serveur enregistre un temps juste avant l'image visée : on revient au début exact de l'image. */
  const depuisServeur = (ms: number | undefined) =>
    ms === undefined ? null : debutImage(Math.round(((ms - decalage) * ips) / 1000));
  const memeImage = (a: number, b: number) => Math.abs(a - b) < dureeImage(ips) / 2;

  // svelte-ignore state_referenced_locally
  let entree = $state<number | null>(depuisServeur(p.decoupe?.entree_ms));
  // svelte-ignore state_referenced_locally
  let sortie = $state<number | null>(depuisServeur(p.decoupe?.sortie_ms));
  let position = $state(0);
  let enLecture = $state(false);
  let lectureSelection = $state(false);
  let elementVideo = $state<HTMLVideoElement | null>(null);
  let timeline = $state<TimelineSource | null>(null);
  let pics = $state<Uint8Array | null>(null);
  let picsParSeconde = $state(100);
  let enregistrement = $state(false);

  // ---- forme d'onde ----
  let picsCharges = "";
  $effect(() => {
    const cle = `${p.id}:${p.pics_piste}`;
    if (p.pics_piste === null || p.pics_piste !== p.piste_audio || cle === picsCharges) return;
    picsCharges = cle;
    void fetch(api.urlPics(p.id)).then(async (r) => {
      if (!r.ok) return;
      picsParSeconde = Number(r.headers.get("x-pics-par-seconde") ?? 100);
      pics = new Uint8Array(await r.arrayBuffer());
    });
  });

  // ---- lecture ----
  let animation = 0;
  function suivrePosition() {
    if (!elementVideo) return;
    position = elementVideo.currentTime * 1000;
    if (enLecture) {
      timeline?.suivre(position);
      if (lectureSelection && sortie !== null && position >= sortie) {
        elementVideo.pause();
        aller(sortie);
      }
      animation = requestAnimationFrame(suivrePosition);
    }
  }

  function aller(ms: number) {
    if (!elementVideo) return;
    const cible = Math.max(0, Math.min(dureeSource, ms));
    elementVideo.currentTime = cible / 1000;
    position = cible;
  }

  function basculer() {
    if (!elementVideo) return;
    lectureSelection = false;
    if (elementVideo.paused) void elementVideo.play();
    else elementVideo.pause();
  }

  function lireSelection() {
    if (!elementVideo || entree === null || sortie === null) return;
    aller(entree);
    lectureSelection = true;
    void elementVideo.play();
  }

  function pas(images: number) {
    elementVideo?.pause();
    // on se place un tiers d'image après le début de l'image : aucune ambiguïté d'arrondi
    aller(debutImage(imageA(position) + images) + dureeImage(ips) / 3);
  }

  function marquerEntree(ms = position) {
    entree = imageAffichee(ms);
    if (sortie !== null && sortie <= entree) sortie = null;
  }

  function marquerSortie(ms = position) {
    const s = imageAffichee(ms);
    sortie = entree !== null && s <= entree ? null : s;
  }

  /** Toute la vidéo : de la première à la dernière image (l'audio peut durer un peu plus). */
  function toutSelectionner() {
    const finVideo = p.source.video.duree_ms ? Math.min(dureeSource, decalage + p.source.video.duree_ms) : dureeSource;
    entree = debutImage(0);
    sortie = debutImage(Math.floor(((finVideo - decalage) * ips) / 1000 + 1e-6));
    timeline?.toutVoir();
  }

  const duree = $derived(entree !== null && sortie !== null ? sortie - entree : null);
  const modifie = $derived(
    entree !== null &&
      sortie !== null &&
      (!p.decoupe || !memeImage(depuisServeur(p.decoupe.entree_ms)!, entree) || !memeImage(depuisServeur(p.decoupe.sortie_ms)!, sortie)),
  );

  async function enregistrer() {
    if (entree === null || sortie === null) return;
    enregistrement = true;
    const ok = await ouvert.modifier({ decoupe: { entree_ms: entree, sortie_ms: sortie } });
    enregistrement = false;
    if (ok) {
      ouvert.notifier("Découpe enregistrée.", "ok");
      entree = depuisServeur(ouvert.projet?.decoupe?.entree_ms) ?? entree;
      sortie = depuisServeur(ouvert.projet?.decoupe?.sortie_ms) ?? sortie;
    }
  }

  function clavier(e: KeyboardEvent) {
    if (dansUnChamp(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const actions: Record<string, () => void> = {
      " ": basculer,
      ArrowLeft: () => pas(e.shiftKey ? -Math.round(ips) : -1),
      ArrowRight: () => pas(e.shiftKey ? Math.round(ips) : 1),
      i: () => marquerEntree(),
      o: () => marquerSortie(),
      l: lireSelection,
      Home: () => entree !== null && aller(entree + dureeImage(ips) / 3),
      End: () => sortie !== null && aller(sortie - dureeImage(ips) * 0.66),
    };
    const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  }

  onMount(() => {
    // on arrive sur la sélection existante
    const depart = p.decoupe ? p.decoupe.entree_ms + dureeImage(ips) / 3 : 0;
    requestAnimationFrame(() => {
      aller(depart);
      if (p.decoupe) timeline?.voirSelection();
    });
    return () => cancelAnimationFrame(animation);
  });

  const conseilDuree = $derived(
    duree === null
      ? ""
      : duree < 3000
        ? "Très court."
        : duree <= 15_000
          ? "Idéal pour le versus (3 à 15 s)."
          : duree <= 60_000
            ? "Bien pour le solo et le co-op."
            : "Au-delà des 60 s conseillées : fichiers plus lourds.",
  );
</script>

<svelte:window onkeydown={clavier} />

<EnteteEtape
  etape="decoupe"
  id={p.id}
  description="Place l'entrée et la sortie à l'image près. Les marges de souffle font partie des répliques (étape 4), pas de la découpe."
/>

{#if !video}
  <p class="message attention">{d.lecture.raison_video ?? "La découpe demande la vidéo source (étape 1)."}</p>
{:else}
  <div class="pile">
    <div class="ecran">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={elementVideo}
        src={video.url}
        preload="auto"
        onplay={() => {
          enLecture = true;
          suivrePosition();
        }}
        onpause={() => {
          enLecture = false;
          suivrePosition();
        }}
        onseeked={suivrePosition}
        onclick={basculer}
      ></video>
      <div class="temps mono">{formaterTemps(position, dureeSource >= 3_600_000)}</div>
    </div>

    <div class="ligne commandes">
      <button onclick={() => pas(-Math.round(ips))} title="Une seconde avant (Maj + ←)">«</button>
      <button onclick={() => pas(-1)} title="Image précédente (←)">‹</button>
      <button class="lecture" onclick={basculer} title="Lecture / pause (Espace)">{enLecture ? "❚❚" : "▶"}</button>
      <button onclick={() => pas(1)} title="Image suivante (→)">›</button>
      <button onclick={() => pas(Math.round(ips))} title="Une seconde après (Maj + →)">»</button>
      <span class="separateur"></span>
      <button onclick={() => marquerEntree()} title="Touche I">Entrée ici <kbd>I</kbd></button>
      <button onclick={() => marquerSortie()} title="Touche O">Sortie ici <kbd>O</kbd></button>
      <button onclick={toutSelectionner} title="Toute la vidéo, de la première à la dernière image">Tout sélectionner</button>
      <button onclick={lireSelection} disabled={entree === null || sortie === null} title="Touche L">Lire la sélection <kbd>L</kbd></button>
      <span class="espaceur"></span>
      <button class="discret petit" onclick={() => timeline?.voirSelection()} disabled={entree === null || sortie === null}>Zoom sélection</button>
      <button class="discret petit" onclick={() => timeline?.toutVoir()}>Tout voir</button>
    </div>

    <TimelineSource
      bind:this={timeline}
      {pics}
      {picsParSeconde}
      dureeMs={dureeSource}
      {entree}
      {sortie}
      {position}
      onseek={(ms, glisse) => {
        if (glisse) {
          lectureSelection = false;
          elementVideo?.pause();
        }
        aller(ms);
      }}
      onentree={(ms) => marquerEntree(ms)}
      onsortie={(ms) => marquerSortie(ms)}
    />
    <p class="discret petit">
      Molette : zoom · Maj + molette ou glisser : défiler · clic : se placer · glisser E ou S : déplacer l'entrée ou la
      sortie · <kbd>Début</kbd> / <kbd>Fin</kbd> : aller à l'entrée ou à la sortie.
    </p>

    <section class="panneau ligne selection">
      <label class="champ">
        Entrée
        <ChampTemps valeur={entree ?? 0} heures={dureeSource >= 3_600_000} onchange={(ms) => marquerEntree(ms + dureeImage(ips) / 3)} />
      </label>
      <label class="champ">
        Sortie
        <ChampTemps valeur={sortie ?? 0} heures={dureeSource >= 3_600_000} onchange={(ms) => marquerSortie(ms + dureeImage(ips) / 3)} />
      </label>
      <div class="pile duree">
        <span class="discret petit">Durée</span>
        <strong>{duree !== null ? formaterDuree(duree) : "—"}</strong>
      </div>
      <span class="discret petit conseil" class:attention={duree !== null && duree > 60_000}>{conseilDuree}</span>
      <span class="espaceur"></span>
      <button class="principal" disabled={!modifie || enregistrement} onclick={enregistrer}>
        {p.decoupe ? "Enregistrer la nouvelle découpe" : "Enregistrer la découpe"}
      </button>
    </section>

    {#if modifie && p.decoupe}
      <p class="message info">
        Nouvelle découpe : il faudra refaire la séparation et tout réencoder.
        {#if p.repliques.length > 0}
          Les {p.repliques.length} répliques seront décalées pour rester sur les mêmes mots ; celles qui sortent de la
          nouvelle plage seront signalées.
        {/if}
      </p>
    {/if}
  </div>
{/if}

<style>
  .ecran {
    position: relative;
    background: #000;
    border-radius: var(--rayon);
    overflow: hidden;
    display: flex;
    justify-content: center;
  }
  video {
    max-height: 48vh;
    max-width: 100%;
    display: block;
    cursor: pointer;
  }
  .temps {
    position: absolute;
    left: 10px;
    bottom: 8px;
    background: rgba(0, 0, 0, 0.65);
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 15px;
  }
  .commandes button {
    min-width: 34px;
    justify-content: center;
  }
  .lecture {
    min-width: 46px !important;
  }
  .separateur {
    width: 1px;
    height: 22px;
    background: var(--bordure-forte);
    margin: 0 6px;
  }
  .selection {
    gap: 16px;
    align-items: flex-end;
  }
  .duree {
    gap: 2px;
  }
  .conseil {
    align-self: center;
  }
</style>
