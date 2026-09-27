<script lang="ts">
  // Étape 4 : les répliques (bornes avec marges de souffle, personnage, texte).
  // Propositions automatiques : détection de parole (VAD de la V2) et transcription Whisper.
  // Les modifications sont enregistrées toutes seules, peu après la dernière.
  import { onDestroy } from "svelte";
  import BarreTache from "../composants/BarreTache.svelte";
  import ChampTemps from "../composants/ChampTemps.svelte";
  import EditeurRepliques from "../composants/EditeurRepliques.svelte";
  import EnteteEtape from "../composants/EnteteEtape.svelte";
  import { api } from "../lib/api.ts";
  import { chargerTampon, Lecteur } from "../lib/lecteur.ts";
  import { couleurDe, dansUnChamp } from "../lib/outils.ts";
  import type { ProjetOuvert } from "../lib/projet.svelte.ts";
  import { studio } from "../lib/studio.svelte.ts";
  import { identifiantLibre, versIdentifiant } from "../../../commun/identifiants.ts";
  import { ipsCible } from "../../../commun/encodage.ts";
  import { dureeExtrait } from "../../../commun/publication.ts";
  import { problemesRepliques, trierRepliques } from "../../../commun/repliques.ts";
  import { formaterTemps } from "../../../commun/temps.ts";
  import { detecterParole } from "../../../commun/vad.ts";
  import type { Personnage, Replique, Transcription } from "../../../commun/types.ts";

  let { ouvert }: { ouvert: ProjetOuvert } = $props();

  const d = $derived(ouvert.detail!);
  const p = $derived(d.projet);
  const duree = $derived(dureeExtrait(p));

  // ---- copie locale, enregistrée automatiquement ----
  // svelte-ignore state_referenced_locally
  let repliques = $state<Replique[]>($state.snapshot(p.repliques));
  // svelte-ignore state_referenced_locally
  let personnages = $state<Personnage[]>($state.snapshot(p.personnages));
  // svelte-ignore state_referenced_locally
  let prochainId = $state(p.prochain_id_replique);
  let sale = $state(false);
  let enregistrement = $state(false);
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  // svelte-ignore state_referenced_locally
  let versionServeur = p.modifie_le;

  $effect(() => {
    // le serveur a changé (autre onglet, tâche, découpe…) : on reprend sa version si rien n'est en attente
    if (p.modifie_le !== versionServeur && !sale && !enregistrement) {
      versionServeur = p.modifie_le;
      repliques = $state.snapshot(p.repliques);
      personnages = $state.snapshot(p.personnages);
      prochainId = p.prochain_id_replique;
    }
  });

  function changer(immediat = false) {
    sale = true;
    if (minuterie) clearTimeout(minuterie);
    minuterie = setTimeout(() => void enregistrer(), immediat ? 0 : 700);
  }

  async function enregistrer() {
    if (!sale) return;
    enregistrement = true;
    sale = false;
    const ok = await ouvert.modifier({
      personnages: $state.snapshot(personnages),
      repliques: $state.snapshot(repliques),
      prochain_id_replique: prochainId,
    });
    versionServeur = ouvert.projet?.modifie_le ?? versionServeur;
    enregistrement = false;
    if (!ok) sale = true;
  }

  onDestroy(() => {
    if (minuterie) clearTimeout(minuterie);
    if (sale) void enregistrer();
    lecteur.detruire();
  });

  // ---- lecture ----
  const lecteur = new Lecteur();
  let tamponVoice = $state<AudioBuffer | null>(null);
  let elementVideo = $state<HTMLVideoElement | null>(null);
  let position = $state(0);
  let enLecture = $state(false);
  let entendre = $state<"voice" | "original">("voice");
  let erreurAudio = $state<string | null>(null);
  lecteur.surPosition = (ms) => {
    position = ms;
    enLecture = lecteur.enLecture;
  };
  lecteur.surFin = () => (enLecture = false);

  $effect(() => {
    lecteur.attacherVideo(elementVideo, d.lecture.video?.decalage_ms ?? 0);
  });

  $effect(() => {
    const url = d.lecture.voice;
    if (!url) return;
    void chargerTampon(url)
      .then((t) => {
        tamponVoice = t;
        lecteur.ajouterPiste("voice", t, entendre === "voice" ? 1 : 0);
        erreurAudio = null;
      })
      .catch((e: Error) => (erreurAudio = e.message));
  });

  $effect(() => {
    const url = d.lecture.mix;
    if (!url) return;
    void chargerTampon(url).then((t) => lecteur.ajouterPiste("original", t, entendre === "original" ? 1 : 0));
  });

  // ---- préférences de l'éditeur, gardées dans le navigateur ----
  function preference(cle: string, defaut: boolean): boolean {
    try {
      const v = localStorage.getItem(`studio.repliques.${cle}`);
      return v === null ? defaut : v === "1";
    } catch {
      return defaut;
    }
  }
  function memoriser(cle: string, valeur: boolean) {
    try {
      localStorage.setItem(`studio.repliques.${cle}`, valeur ? "1" : "0");
    } catch {
      // stockage indisponible : la préférence ne dure que la session
    }
  }
  let apercuSurvol = $state(preference("survol", true));
  let sonImage = $state(preference("son-image", true));

  // ---- image par image ----
  const dureeImageMs = $derived(1000 / ipsCible(p.source.video.ips));
  function pas(images: number) {
    lecteur.pause();
    enLecture = false;
    const cible = Math.max(0, Math.min(duree, (Math.round(position / dureeImageMs) + images) * dureeImageMs));
    lecteur.aller(cible);
    position = cible;
    if (sonImage) lecteur.apercu(cible, Math.max(dureeImageMs, 60) * (Math.abs(images) > 1 ? 4 : 1));
  }

  function basculerEcoute(quoi: "voice" | "original") {
    entendre = quoi;
    lecteur.solo(quoi);
  }

  function lireReplique(r: Replique) {
    lecteur.jouer(r.debut_ms, r.fin_ms);
    enLecture = true;
  }

  // ---- sélection et édition ----
  let selection = $state<number | null>(null);
  let editeur = $state<EditeurRepliques | null>(null);
  const choisie = $derived(repliques.find((r) => r.id === selection) ?? null);
  const triees = $derived(trierRepliques(repliques));
  const problemes = $derived(problemesRepliques(repliques, duree, personnages));
  const problemesDe = (id: number) => problemes.filter((x) => x.replique === id);

  function selectionner(id: number | null, montrer = false) {
    selection = id;
    if (id !== null && montrer) editeur?.montrer(id);
  }

  function modifierReplique(id: number, changements: Partial<Replique>, immediat = false) {
    const r = repliques.find((x) => x.id === id);
    if (!r) return;
    Object.assign(r, changements);
    changer(immediat);
  }

  function nouvelleReplique(debut: number, fin: number, texte = "", personnage?: string) {
    const r: Replique = {
      id: prochainId,
      personnage: personnage ?? (personnages.length === 1 ? personnages[0].id : (choisie?.personnage ?? "")),
      debut_ms: Math.round(debut),
      fin_ms: Math.round(fin),
      texte,
    };
    prochainId += 1;
    repliques.push(r);
    changer();
    return r;
  }

  function supprimer(id: number) {
    const i = triees.findIndex((r) => r.id === id);
    repliques = repliques.filter((r) => r.id !== id);
    selection = triees[i + 1]?.id ?? triees[i - 1]?.id ?? null;
    changer(true);
  }

  // ---- personnages ----
  let nouveauNom = $state("");
  function ajouterPersonnage() {
    const nom = nouveauNom.trim();
    if (!nom) return;
    const id = identifiantLibre(versIdentifiant(nom) || "personnage", new Set(personnages.map((x) => x.id)));
    personnages.push({ id, nom });
    nouveauNom = "";
    if (choisie && !personnages.some((x) => x.id === choisie.personnage)) choisie.personnage = id;
    changer();
  }
  function retirerPersonnage(id: string) {
    personnages = personnages.filter((x) => x.id !== id);
    for (const r of repliques) if (r.personnage === id) r.personnage = "";
    changer(true);
  }
  const nombreRepliques = (id: string) => repliques.filter((r) => r.personnage === id).length;

  // ---- propositions automatiques ----
  let detection = $state<string | null>(null);
  function detecter() {
    if (!tamponVoice) return;
    const canaux = Array.from({ length: tamponVoice.numberOfChannels }, (_, c) => tamponVoice!.getChannelData(c));
    const segments = detecterParole(canaux, tamponVoice.sampleRate);
    let ajoutees = 0;
    for (const s of segments) {
      const chevauche = repliques.some((r) => s.debut_ms < r.fin_ms && s.fin_ms > r.debut_ms);
      if (!chevauche) {
        nouvelleReplique(s.debut_ms, s.fin_ms);
        ajoutees++;
      }
    }
    detection = `${segments.length} passage(s) de parole détecté(s), ${ajoutees} réplique(s) ajoutée(s) là où il n'y en avait pas.`;
  }

  let transcription = $state<Transcription | null>(null);
  $effect(() => {
    if (p.transcription) void api.transcription(p.id).then((t) => (transcription = t)).catch(() => (transcription = null));
  });
  const tacheTranscription = $derived(studio.derniereTache(p.id, "transcription"));
  const transcriptionEnCours = $derived(tacheTranscription?.etat === "en_cours" || tacheTranscription?.etat === "attente");

  /** Texte des mots dont le milieu tombe dans la réplique. */
  function motsDe(debut: number, fin: number): string {
    if (!transcription) return "";
    return transcription.segments
      .flatMap((s) => s.mots)
      .filter((m) => (m.debut_ms + m.fin_ms) / 2 >= debut && (m.debut_ms + m.fin_ms) / 2 <= fin)
      .map((m) => m.mot)
      .join("")
      .trim();
  }

  function remplirTextes() {
    let n = 0;
    for (const r of repliques) {
      if (r.texte.trim()) continue;
      const texte = motsDe(r.debut_ms, r.fin_ms);
      if (texte) {
        r.texte = texte;
        n++;
      }
    }
    changer();
    detection = `${n} texte(s) rempli(s) depuis la transcription.`;
  }

  function creerDepuisTranscription() {
    if (!transcription) return;
    for (const s of transcription.segments) {
      nouvelleReplique(Math.max(0, s.debut_ms - 150), Math.min(duree, s.fin_ms + 150), s.texte);
    }
    detection = `${transcription.segments.length} réplique(s) créée(s) depuis la transcription : vérifie les bornes et attribue les personnages.`;
  }

  // ---- clavier ----
  function clavier(e: KeyboardEvent) {
    if (dansUnChamp(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const i = triees.findIndex((r) => r.id === selection);
    if (e.key === " ") {
      lecteur.basculer();
      enLecture = lecteur.enLecture;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const sens = e.key === "ArrowLeft" ? -1 : 1;
      pas(e.shiftKey ? sens * Math.round(1000 / dureeImageMs) : sens);
    } else if (e.key === "Enter" && choisie) lireReplique(choisie);
    else if ((e.key === "Delete" || e.key === "Backspace") && choisie) supprimer(choisie.id);
    else if (e.key.toLowerCase() === "n") selectionner(nouvelleReplique(position, Math.min(duree, position + 1500)).id);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const suivante = triees[Math.max(0, Math.min(triees.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (suivante) {
        selectionner(suivante.id, true);
        lecteur.aller(suivante.debut_ms);
      }
    } else if (/^[1-9]$/.test(e.key) && choisie) {
      const perso = personnages[Number(e.key) - 1];
      if (perso) modifierReplique(choisie.id, { personnage: perso.id }, true);
    } else if (e.key === "Escape") selectionner(null);
    else return;
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={clavier} />

<EnteteEtape
  etape="repliques"
  id={p.id}
  description="Chaque réplique : une zone sur la voice, marges de souffle comprises, avec son personnage et son texte. Les id ne sont jamais réutilisés."
>
  {#snippet actions()}
    <span class="petit discret etat-enregistrement">
      {enregistrement ? "Enregistrement…" : sale ? "Modifié" : "✓ Enregistré"}
    </span>
  {/snippet}
</EnteteEtape>

{#if !p.decoupe}
  <p class="message attention">Fais d'abord la découpe (étape 2).</p>
{:else}
  {#if !d.lecture.voice}
    <p class="message attention">Pas de voice à afficher : lance une séparation (étape 3). Les répliques restent modifiables dans la liste.</p>
  {/if}
  {#if erreurAudio}<p class="message erreur">{erreurAudio}</p>{/if}

  <div class="haut">
    <div class="video">
      {#if d.lecture.video}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={elementVideo} src={d.lecture.video.url} preload="auto" muted></video>
      {:else}
        <div class="sans-video discret petit">{d.lecture.raison_video}</div>
      {/if}
    </div>

    <section class="panneau pile detail">
      {#if choisie}
        <div class="ligne">
          <h3>Réplique {choisie.id}</h3>
          <span class="espaceur"></span>
          <button class="petit" onclick={() => lireReplique(choisie)}>▶ Écouter <kbd>Entrée</kbd></button>
          <button class="petit danger" onclick={() => supprimer(choisie.id)}>Supprimer</button>
        </div>
        <div class="ligne">
          <label class="champ">
            Début
            <ChampTemps valeur={choisie.debut_ms} onchange={(ms) => modifierReplique(choisie.id, { debut_ms: ms }, true)} />
          </label>
          <label class="champ">
            Fin
            <ChampTemps valeur={choisie.fin_ms} onchange={(ms) => modifierReplique(choisie.id, { fin_ms: ms }, true)} />
          </label>
          <div class="champ">
            <span class="discret petit">Durée</span>
            <span class="mono">{((choisie.fin_ms - choisie.debut_ms) / 1000).toFixed(2)} s</span>
          </div>
        </div>
        <div class="personnages-choix">
          {#each personnages as perso, i (perso.id)}
            <button
              class="petit"
              class:actif={choisie.personnage === perso.id}
              style:--c={couleurDe(personnages, perso.id)}
              onclick={() => modifierReplique(choisie.id, { personnage: perso.id }, true)}
            >
              <span class="puce"></span>{perso.nom} <kbd>{i + 1}</kbd>
            </button>
          {/each}
        </div>
        <label class="champ">
          Texte
          <textarea
            rows="2"
            value={choisie.texte}
            oninput={(e) => modifierReplique(choisie.id, { texte: (e.currentTarget as HTMLTextAreaElement).value })}
          ></textarea>
        </label>
        {#if transcription && !choisie.texte.trim() && motsDe(choisie.debut_ms, choisie.fin_ms)}
          <button class="petit discret" onclick={() => modifierReplique(choisie.id, { texte: motsDe(choisie.debut_ms, choisie.fin_ms) }, true)}>
            Whisper propose : « {motsDe(choisie.debut_ms, choisie.fin_ms)} »
          </button>
        {/if}
        {#each problemesDe(choisie.id) as pb, i (i)}
          <p class="petit" class:erreur={pb.grave} class:attention={!pb.grave}>{pb.message}</p>
        {/each}
      {:else}
        <p class="discret">
          Glisse sur la forme d'onde pour créer une réplique, ou clique sur une réplique pour la modifier.
        </p>
      {/if}

      <h3 class="espace-haut">Personnages</h3>
      {#each personnages as perso (perso.id)}
        <div class="ligne personnage">
          <span class="puce" style:--c={couleurDe(personnages, perso.id)}></span>
          <input
            value={perso.nom}
            oninput={(e) => {
              perso.nom = (e.currentTarget as HTMLInputElement).value;
              changer();
            }}
          />
          <span class="mono discret petit">{perso.id}</span>
          <span class="discret petit">{nombreRepliques(perso.id)} répl.</span>
          <button class="discret petit" onclick={() => retirerPersonnage(perso.id)} aria-label="Retirer {perso.nom}">✕</button>
        </div>
      {/each}
      <form
        class="ligne"
        onsubmit={(e) => {
          e.preventDefault();
          ajouterPersonnage();
        }}
      >
        <input bind:value={nouveauNom} placeholder="Nouveau personnage" />
        <button type="submit" disabled={!nouveauNom.trim()}>Ajouter</button>
      </form>
    </section>
  </div>

  <div class="ligne barre">
    <button
      class="lecture"
      onclick={() => {
        lecteur.basculer();
        enLecture = lecteur.enLecture;
      }}>{enLecture ? "❚❚" : "▶"}</button
    >
    <span class="mono">{formaterTemps(position)} / {formaterTemps(duree)}</span>
    <span class="discret petit">Entendre :</span>
    <button class="petit" class:actif={entendre === "voice"} onclick={() => basculerEcoute("voice")} disabled={!d.lecture.voice}>Voice</button>
    <button class="petit" class:actif={entendre === "original"} onclick={() => basculerEcoute("original")} disabled={!d.lecture.mix}>Original</button>
    <span class="separateur"></span>
    <button
      class="petit"
      class:actif={apercuSurvol}
      title="Montre la réplique sous la souris"
      onclick={() => memoriser("survol", (apercuSurvol = !apercuSurvol))}>Aperçu au survol</button
    >
    <button
      class="petit"
      class:actif={sonImage}
      title="Fait entendre le son à chaque image avec ← et →"
      onclick={() => memoriser("son-image", (sonImage = !sonImage))}>Son image par image</button
    >
    <span class="separateur"></span>
    <button class="petit" onclick={() => editeur?.zoomArriere()}>−</button>
    <button class="petit" onclick={() => editeur?.zoomAvant()}>+</button>
    <button class="petit" onclick={() => editeur?.toutVoir()}>Tout</button>
    <span class="espaceur"></span>
    <button class="petit" onclick={() => selectionner(nouvelleReplique(position, Math.min(duree, position + 1500)).id)}>
      + Réplique au curseur <kbd>N</kbd>
    </button>
    <button class="petit" onclick={detecter} disabled={!tamponVoice}>Détecter la parole</button>
    <button
      class="petit"
      onclick={() => ouvert.action(() => api.transcrire(p.id))}
      disabled={!d.wav.voice || transcriptionEnCours || !studio.serveur?.outils.faster_whisper}
      title={d.wav.voice ? "Transcription avec horodatage mot par mot (faster-whisper)" : "Il faut une voice séparée (étape 3)"}
    >
      Transcrire (Whisper)
    </button>
    {#if transcription}
      {#if repliques.length === 0}
        <button class="petit" onclick={creerDepuisTranscription}>Créer depuis la transcription</button>
      {:else}
        <button class="petit" onclick={remplirTextes}>Remplir les textes vides</button>
      {/if}
    {/if}
  </div>
  {#if transcriptionEnCours && tacheTranscription}<BarreTache tache={tacheTranscription} />{/if}
  {#if tacheTranscription?.etat === "erreur"}<BarreTache tache={tacheTranscription} />{/if}
  {#if detection}<p class="message info">{detection}</p>{/if}

  <EditeurRepliques
    bind:this={editeur}
    tampon={tamponVoice}
    dureeMs={duree}
    {repliques}
    {personnages}
    {selection}
    {position}
    {enLecture}
    survol={apercuSurvol}
    onselect={(id) => selectionner(id)}
    onchange={(id, debut, fin) => modifierReplique(id, { debut_ms: debut, fin_ms: fin })}
    onfin={() => changer(true)}
    oncreate={(debut, fin) => selectionner(nouvelleReplique(debut, fin).id)}
    onseek={(ms) => lecteur.aller(ms)}
  />
  <p class="discret petit">
    <kbd>Espace</kbd> lecture · <kbd>←</kbd> <kbd>→</kbd> image par image (<kbd>Maj</kbd> : 1 s) · <kbd>Entrée</kbd> écouter la réplique ·
    <kbd>↑</kbd> <kbd>↓</kbd> réplique précédente / suivante ·
    <kbd>1</kbd>…<kbd>9</kbd> personnage · <kbd>Suppr</kbd> supprimer · <kbd>Ctrl</kbd> + molette : zoom
  </p>

  <table class="liste">
    <thead>
      <tr><th>#</th><th>Personnage</th><th>Début</th><th>Fin</th><th>Durée</th><th>Texte</th><th></th></tr>
    </thead>
    <tbody>
      {#each triees as r (r.id)}
        {@const pbs = problemesDe(r.id)}
        <tr class:choisie={r.id === selection} onclick={() => selectionner(r.id, true)}>
          <td class="mono discret">{r.id}</td>
          <td>
            <span class="puce" style:--c={couleurDe(personnages, r.personnage)}></span>
            {personnages.find((x) => x.id === r.personnage)?.nom ?? "—"}
          </td>
          <td class="mono">{formaterTemps(r.debut_ms)}</td>
          <td class="mono">{formaterTemps(r.fin_ms)}</td>
          <td class="mono discret">{((r.fin_ms - r.debut_ms) / 1000).toFixed(2)} s</td>
          <td class="texte">{r.texte || "—"}</td>
          <td title={pbs.map((x) => x.message).join("\n")}>
            {#if pbs.some((x) => x.grave)}<span class="erreur">●</span>{:else if pbs.length}<span class="attention">●</span>{/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="7" class="discret">Aucune réplique.</td></tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .haut {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(320px, 0.9fr);
    gap: 14px;
    align-items: start;
    margin-bottom: 12px;
  }
  video {
    width: 100%;
    max-height: 38vh;
    background: #000;
    border-radius: var(--rayon);
    display: block;
  }
  .sans-video {
    aspect-ratio: 16 / 9;
    background: #000;
    border-radius: var(--rayon);
    display: grid;
    place-items: center;
  }
  .detail {
    gap: 10px;
  }
  .espace-haut {
    margin-top: 6px;
  }
  .personnages-choix {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .puce {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--c);
    flex-shrink: 0;
  }
  .personnage input {
    flex: 1;
  }
  .barre {
    margin-bottom: 8px;
  }
  .lecture {
    min-width: 44px;
    justify-content: center;
  }
  .separateur {
    width: 1px;
    height: 20px;
    background: var(--bordure-forte);
    margin: 0 4px;
  }
  .liste {
    margin-top: 14px;
  }
  .liste tr {
    cursor: pointer;
  }
  .liste tr:hover td {
    background: var(--fond-2);
  }
  .liste tr.choisie td {
    background: var(--panneau-2);
  }
  .texte {
    max-width: 420px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .etat-enregistrement {
    align-self: center;
  }
</style>
