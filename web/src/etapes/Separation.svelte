<script lang="ts">
  // Étape 3 : séparation voix / fond (fiche 7.5). On peut lancer plusieurs modèles, les écouter
  // côte à côte, et garder la meilleure voice et le meilleur bed, même s'ils viennent de modèles différents.
  import { onDestroy } from "svelte";
  import BarreTache from "../composants/BarreTache.svelte";
  import EnteteEtape from "../composants/EnteteEtape.svelte";
  import { api } from "../lib/api.ts";
  import { chargerTampon, Lecteur } from "../lib/lecteur.ts";
  import { dansUnChamp, dateLisible } from "../lib/outils.ts";
  import type { ProjetOuvert } from "../lib/projet.svelte.ts";
  import { studio } from "../lib/studio.svelte.ts";
  import { dureeExtrait } from "../../../commun/publication.ts";
  import { formaterTemps } from "../../../commun/temps.ts";

  let { ouvert }: { ouvert: ProjetOuvert } = $props();

  const d = $derived(ouvert.detail!);
  const p = $derived(d.projet);
  const modeles = $derived(studio.serveur?.modeles_separation ?? []);
  const outilsOk = $derived(!!studio.serveur?.outils.audio_separator);

  // svelte-ignore state_referenced_locally
  let choisis = $state(new Set<string>(studio.serveur?.modeles_separation.filter((m) => m.defaut).map((m) => m.fichier) ?? []));
  const tachesSeparation = $derived(
    studio.tachesProjet(p.id, "separation").filter((t) => t.etat === "attente" || t.etat === "en_cours" || t.etat === "erreur"),
  );

  async function lancer() {
    await ouvert.action(() => api.separer(p.id, [...choisis]));
  }

  // ---- comparaison ----
  const lecteur = new Lecteur();
  let elementVideo = $state<HTMLVideoElement | null>(null);
  let position = $state(0);
  let enLecture = $state(false);
  let ecoute = $state("original");
  let chargement = $state(false);
  let erreurChargement = $state<string | null>(null);
  lecteur.surPosition = (ms) => {
    position = ms;
    enLecture = lecteur.enLecture;
  };
  lecteur.surFin = () => (enLecture = false);
  onDestroy(() => lecteur.detruire());

  const duree = $derived(dureeExtrait(p));
  const pistes = $derived.by(() => {
    const liste: { nom: string; libelle: string; url: string }[] = [];
    if (d.lecture.mix) liste.push({ nom: "original", libelle: "Original", url: d.lecture.mix });
    for (const s of p.separations) {
      liste.push({ nom: `voice:${s.id}`, libelle: "Voice", url: api.urlMedia(p.id, `separation-${s.id}-voice`) });
      liste.push({ nom: `bed:${s.id}`, libelle: "Bed", url: api.urlMedia(p.id, `separation-${s.id}-bed`) });
    }
    return liste;
  });

  $effect(() => {
    lecteur.attacherVideo(elementVideo, d.lecture.video?.decalage_ms ?? 0);
  });

  $effect(() => {
    for (const nom of lecteur.noms()) if (!pistes.some((x) => x.nom === nom)) lecteur.retirerPiste(nom);
    const aCharger = pistes.filter((x) => !lecteur.aPiste(x.nom));
    if (aCharger.length === 0) return;
    chargement = true;
    void Promise.all(
      aCharger.map(async (x) => {
        const tampon = await chargerTampon(x.url);
        lecteur.ajouterPiste(x.nom, tampon, 0);
      }),
    )
      .then(() => {
        erreurChargement = null;
        lecteur.solo(pistes.some((x) => x.nom === ecoute) ? ecoute : "original");
      })
      .catch((e: Error) => (erreurChargement = e.message))
      .finally(() => (chargement = false));
  });

  function ecouter(nom: string) {
    ecoute = nom;
    lecteur.solo(nom);
    if (!lecteur.enLecture) lecteur.jouer(position);
  }

  function clavier(e: KeyboardEvent) {
    if (dansUnChamp(e)) return;
    if (e.key === " ") {
      e.preventDefault();
      lecteur.basculer();
      enLecture = lecteur.enLecture;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      lecteur.aller(position + (e.key === "ArrowLeft" ? -2000 : 2000));
    } else if (/^[1-9]$/.test(e.key)) {
      const piste = pistes[Number(e.key) - 1];
      if (piste) ecouter(piste.nom);
    }
  }

  const choixVoice = $derived(p.voice?.origine === "separation" ? p.voice.separation : null);
  const choixBed = $derived(p.bed?.origine === "separation" ? p.bed.separation : null);
</script>

<svelte:window onkeydown={clavier} />

<EnteteEtape
  etape="separation"
  id={p.id}
  description="La voice (voix originales) sert de guide aux joueurs ; le bed (musique et effets) est joué sous leur doublage. Lance un ou plusieurs modèles, écoute, puis garde la meilleure piste de chacun."
/>

{#if !p.decoupe}
  <p class="message attention">Fais d'abord la découpe (étape 2).</p>
{:else}
  <div class="grille">
    <section class="panneau pile">
      <h2>Modèles</h2>
      {#if !outilsOk}
        <p class="message erreur">audio-separator n'est pas installé : lance <code>npm run python:installer</code> dans studio/.</p>
      {/if}
      {#each ["Demucs", "Roformer", "MDX-Net"] as famille (famille)}
        <div class="famille">
          <div class="discret petit">{famille}{famille === "Demucs" ? "" : " (UVR)"}</div>
          {#each modeles.filter((m) => m.famille === famille) as m (m.fichier)}
            <label class="case modele">
              <input
                type="checkbox"
                checked={choisis.has(m.fichier)}
                onchange={(e) => {
                  const s = new Set(choisis);
                  if ((e.currentTarget as HTMLInputElement).checked) s.add(m.fichier);
                  else s.delete(m.fichier);
                  choisis = s;
                }}
              />
              <span><strong>{m.libelle}</strong> <span class="discret petit">{m.description}</span></span>
            </label>
          {/each}
        </div>
      {/each}
      <div class="ligne">
        <button class="principal" disabled={choisis.size === 0 || !outilsOk} onclick={lancer}>
          Lancer {choisis.size > 1 ? `les ${choisis.size} séparations` : "la séparation"}
        </button>
        <span class="discret petit">Les modèles sont téléchargés au premier usage.</span>
      </div>
      {#each tachesSeparation as t (t.id)}
        <div class="pile tache">
          <span class="petit">{t.libelle}</span>
          <BarreTache tache={t} />
        </div>
      {/each}
    </section>

    <section class="panneau pile">
      <h2>Volume</h2>
      {#if p.mix && p.gain_db !== null}
        <p>
          Mélange original : <strong>{p.mix.loudness_lufs?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "silence"} LUFS</strong>
          → gain de <strong>{p.gain_db > 0 ? "+" : ""}{p.gain_db.toLocaleString("fr-FR")} dB</strong> sur la voice et le bed
        </p>
        <p class="discret petit">
          Le même gain est appliqué aux deux pistes pour garder l'équilibre voix / fond, avec un limiteur à −1 dB. Cible :
          −16 LUFS.
        </p>
      {:else}
        <p class="discret">Mesuré sur l'audio original de la plage au lancement de la première séparation.</p>
      {/if}
      <h2>Pistes retenues</h2>
      <p>
        Voice : <strong>{p.voice?.origine === "separation" ? (p.separations.find((s) => s.id === choixVoice)?.libelle ?? "?") : p.voice?.origine === "publie" ? "piste publiée" : "à choisir"}</strong><br />
        Bed : <strong>{p.bed?.origine === "separation" ? (p.separations.find((s) => s.id === choixBed)?.libelle ?? "?") : p.bed?.origine === "publie" ? "piste publiée" : "à choisir"}</strong>
      </p>
      {#if p.voice?.origine === "publie"}
        <p class="discret petit">Projet repris d'un extrait publié : relance une séparation pour changer les pistes.</p>
      {/if}
    </section>
  </div>

  {#if pistes.length > 0}
    <section class="panneau pile comparaison">
      <div class="ligne">
        <h2>Écouter et comparer</h2>
        <span class="discret petit">
          <kbd>Espace</kbd> lecture · <kbd>←</kbd> <kbd>→</kbd> ±2 s · <kbd>1</kbd>…<kbd>9</kbd> changer de piste sans couper
        </span>
      </div>
      <div class="lecture">
        {#if d.lecture.video}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video bind:this={elementVideo} src={d.lecture.video.url} preload="auto" muted></video>
        {/if}
        <div class="pile controles">
          <div class="ligne">
            <button
              class="principal"
              onclick={() => {
                lecteur.basculer();
                enLecture = lecteur.enLecture;
              }}
              disabled={chargement}>{enLecture ? "❚❚ Pause" : "▶ Lecture"}</button
            >
            <span class="mono">{formaterTemps(position)} / {formaterTemps(duree)}</span>
            {#if chargement}<span class="discret petit">Chargement des pistes…</span>{/if}
          </div>
          <input
            type="range"
            min="0"
            max={duree}
            step="10"
            value={position}
            oninput={(e) => lecteur.aller(Number((e.currentTarget as HTMLInputElement).value))}
          />
          {#if erreurChargement}<p class="erreur petit">{erreurChargement}</p>{/if}
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Écouter</th>
                <th>Garder la voice</th>
                <th>Garder le bed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#if d.lecture.mix}
                <tr>
                  <td>Original <span class="discret petit">(mélange de la plage)</span></td>
                  <td><button class="petit" class:actif={ecoute === "original"} onclick={() => ecouter("original")}>1 · Original</button></td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              {/if}
              {#each p.separations as s, i (s.id)}
                <tr>
                  <td>
                    <strong>{s.libelle}</strong>
                    <div class="discret petit">{dateLisible(s.cree_le)}</div>
                  </td>
                  <td class="ligne">
                    <button class="petit" class:actif={ecoute === `voice:${s.id}`} onclick={() => ecouter(`voice:${s.id}`)}>{2 + i * 2} · Voice</button>
                    <button class="petit" class:actif={ecoute === `bed:${s.id}`} onclick={() => ecouter(`bed:${s.id}`)}>{3 + i * 2} · Bed</button>
                  </td>
                  <td>
                    <input
                      type="radio"
                      name="voice"
                      checked={choixVoice === s.id}
                      onchange={() => ouvert.modifier({ voice: { origine: "separation", separation: s.id } })}
                    />
                  </td>
                  <td>
                    <input
                      type="radio"
                      name="bed"
                      checked={choixBed === s.id}
                      onchange={() => ouvert.modifier({ bed: { origine: "separation", separation: s.id } })}
                    />
                  </td>
                  <td style="text-align:right">
                    <button class="discret petit danger" onclick={() => ouvert.action(() => api.supprimerSeparation(p.id, s.id))}>Supprimer</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="discret petit">
            Astuce : écoute le bed sur les passages parlés. S'il reste des bribes de voix, le doublage des joueurs sonnera
            faux : essaie un autre modèle (Roformer est souvent meilleur sur les dialogues).
          </p>
        </div>
      </div>
    </section>
  {/if}
{/if}

<style>
  .grille {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
    margin-bottom: 16px;
  }
  .famille {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .modele {
    align-items: flex-start;
  }
  .modele input {
    margin-top: 3px;
  }
  .tache {
    gap: 4px;
  }
  .lecture {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: 16px;
    align-items: start;
  }
  video {
    width: 100%;
    border-radius: var(--rayon-petit);
    background: #000;
  }
  .controles input[type="range"] {
    width: 100%;
  }
  td.ligne {
    flex-wrap: nowrap;
  }
</style>
