<script lang="ts">
  // Étape 3 : séparation voix / fond (fiche 7.5). On peut lancer plusieurs modèles, les écouter
  // côte à côte, et garder la meilleure voice et le meilleur bed, même s'ils viennent de modèles différents.
  // Une piste peut aussi être téléchargée, retouchée dans un autre logiciel, puis réimportée.
  import { onDestroy } from "svelte";
  import BarreTache from "../composants/BarreTache.svelte";
  import EnteteEtape from "../composants/EnteteEtape.svelte";
  import Modale from "../composants/Modale.svelte";
  import { api } from "../lib/api.ts";
  import { chargerTampon, Lecteur } from "../lib/lecteur.ts";
  import { dansUnChamp, dateLisible } from "../lib/outils.ts";
  import type { ProjetOuvert } from "../lib/projet.svelte.ts";
  import { studio } from "../lib/studio.svelte.ts";
  import { dureeExtrait } from "../../../commun/publication.ts";
  import { formaterTemps } from "../../../commun/temps.ts";
  import type { AnalyseImport, ChoixPiste } from "../../../commun/types.ts";

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

  /** Toutes les pistes écoutables, dans l'ordre des touches 1 à 9. */
  const pistes = $derived.by(() => {
    const liste: { nom: string; url: string }[] = [];
    if (d.lecture.mix) liste.push({ nom: "original", url: d.lecture.mix });
    for (const s of p.separations) {
      liste.push({ nom: `voice:${s.id}`, url: api.urlMedia(p.id, `separation-${s.id}-voice`) });
      liste.push({ nom: `bed:${s.id}`, url: api.urlMedia(p.id, `separation-${s.id}-bed`) });
    }
    for (const i of p.imports) liste.push({ nom: `import:${i.id}`, url: `${api.urlMedia(p.id, `import-${i.id}`)}?v=${i.empreinte}` });
    return liste;
  });
  const touche = (nom: string) => {
    const i = pistes.findIndex((x) => x.nom === nom);
    return i >= 0 && i < 9 ? `${i + 1} · ` : "";
  };

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
    if (dansUnChamp(e) || importEnCours) return;
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

  const estChoisie = (choix: ChoixPiste | null, origine: "separation" | "import", id: string) =>
    !!choix && ((origine === "separation" && choix.origine === "separation" && choix.separation === id) ||
      (origine === "import" && choix.origine === "import" && choix.import === id));

  function libelleChoix(choix: ChoixPiste | null): string {
    if (!choix) return "à choisir";
    if (choix.origine === "separation") return p.separations.find((s) => s.id === choix.separation)?.libelle ?? "?";
    if (choix.origine === "import") return `import « ${p.imports.find((i) => i.id === choix.import)?.nom ?? "?"} »`;
    return "piste publiée";
  }

  // ---- retouche dans un autre logiciel ----
  let champFichier = $state<HTMLInputElement | null>(null);
  let quoiImport = $state<"voice" | "bed">("voice");
  let envoi = $state<number | null>(null);
  let analyse = $state<AnalyseImport | null>(null);
  let recaler = $state(true);
  let decalage = $state(0);
  let validation = $state(false);
  const importEnCours = $derived(analyse !== null);

  function importer(quoi: "voice" | "bed") {
    quoiImport = quoi;
    champFichier?.click();
  }

  async function envoyer(fichier: File | undefined) {
    if (!fichier) return;
    envoi = 0;
    try {
      analyse = await api.importer(p.id, quoiImport, fichier, (v) => (envoi = v));
      const d = analyse.decalage_ms ?? 0;
      recaler = Math.abs(d) >= 5 && (analyse.confiance ?? 0) >= 0.3;
      decalage = d;
    } catch (e) {
      ouvert.notifier((e as Error).message, "erreur");
    } finally {
      envoi = null;
      if (champFichier) champFichier.value = "";
    }
  }

  async function valider() {
    if (!analyse) return;
    validation = true;
    const r = await ouvert.action(
      () => api.validerImport(p.id, analyse!.import, recaler ? decalage : 0),
      `${analyse.quoi === "voice" ? "Voice" : "Bed"} importé et choisi.`,
    );
    validation = false;
    if (r) {
      await ouvert.recharger();
      analyse = null;
    }
  }

  const ecart = $derived(analyse ? analyse.duree_ms - (recaler ? decalage : 0) - analyse.attendu_ms : 0);
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

    <div class="pile">
      <section class="panneau pile">
        <h2>Pistes retenues</h2>
        <p>
          Voice : <strong>{libelleChoix(p.voice)}</strong><br />
          Bed : <strong>{libelleChoix(p.bed)}</strong>
        </p>
        {#if p.mix && p.gain_db !== null}
          <p class="petit">
            Mélange original : {p.mix.loudness_lufs?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "silence"} LUFS
            → gain de <strong>{p.gain_db > 0 ? "+" : ""}{p.gain_db.toLocaleString("fr-FR")} dB</strong> sur la voice et le bed
            <span class="discret">(le même sur les deux pour garder l'équilibre, limiteur à −1 dB, cible −16 LUFS)</span>
          </p>
        {:else}
          <p class="discret petit">Le volume est mesuré sur l'audio original de la plage à la première séparation.</p>
        {/if}
        {#if p.voice?.origine === "publie"}
          <p class="discret petit">Projet repris d'un extrait publié : relance une séparation ou importe une piste pour les changer.</p>
        {/if}
      </section>

      <section class="panneau pile">
        <h2>Retoucher dans un autre logiciel</h2>
        <ol class="petit etapes-retouche">
          <li>Télécharge la piste à corriger avec <strong>⬇</strong> dans le tableau ci-dessous (WAV 48 kHz 24 bits, durée exacte de l'extrait).</li>
          <li>Retouche-la (Audacity, Reaper, iZotope RX…) : nettoyer une voix qui bave dans le bed, retirer un bruit…</li>
          <li>Réimporte-la : le Studio la recale sur l'original et la remet aux normes.</li>
        </ol>
        <div class="ligne">
          <button onclick={() => importer("voice")} disabled={envoi !== null}>Importer une voice…</button>
          <button onclick={() => importer("bed")} disabled={envoi !== null}>Importer un bed…</button>
          {#if envoi !== null}<span class="discret petit">Envoi et analyse… {Math.round(envoi * 100)} %</span>{/if}
        </div>
        <input
          bind:this={champFichier}
          type="file"
          accept=".wav,.flac,.aif,.aiff,.mp3,.m4a,.aac,.ogg,.opus,audio/*"
          hidden
          onchange={(e) => envoyer((e.currentTarget as HTMLInputElement).files?.[0])}
        />
      </section>
    </div>
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
                <th>Voice</th>
                <th>Bed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#if d.lecture.mix}
                <tr>
                  <td>Original <span class="discret petit">(mélange de la plage)</span></td>
                  <td class="ligne">
                    <button class="petit" class:actif={ecoute === "original"} onclick={() => ecouter("original")}>{touche("original")}Original</button>
                    <a class="bouton petit" href={api.urlExport(p.id, "original")} download title="Télécharger pour retoucher">⬇</a>
                  </td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              {/if}
              {#each p.separations as s (s.id)}
                <tr>
                  <td>
                    <strong>{s.libelle}</strong>
                    <div class="discret petit">{dateLisible(s.cree_le)}</div>
                  </td>
                  <td class="ligne">
                    <button class="petit" class:actif={ecoute === `voice:${s.id}`} onclick={() => ecouter(`voice:${s.id}`)}>{touche(`voice:${s.id}`)}Voice</button>
                    <a class="bouton petit" href={api.urlExport(p.id, `separation-${s.id}-voice`)} download title="Télécharger la voice pour la retoucher">⬇</a>
                    <button class="petit" class:actif={ecoute === `bed:${s.id}`} onclick={() => ecouter(`bed:${s.id}`)}>{touche(`bed:${s.id}`)}Bed</button>
                    <a class="bouton petit" href={api.urlExport(p.id, `separation-${s.id}-bed`)} download title="Télécharger le bed pour le retoucher">⬇</a>
                  </td>
                  <td>
                    <input
                      type="radio"
                      name="voice"
                      aria-label="Garder cette voice"
                      checked={estChoisie(p.voice, "separation", s.id)}
                      onchange={() => ouvert.modifier({ voice: { origine: "separation", separation: s.id } })}
                    />
                  </td>
                  <td>
                    <input
                      type="radio"
                      name="bed"
                      aria-label="Garder ce bed"
                      checked={estChoisie(p.bed, "separation", s.id)}
                      onchange={() => ouvert.modifier({ bed: { origine: "separation", separation: s.id } })}
                    />
                  </td>
                  <td style="text-align:right">
                    <button class="discret petit danger" onclick={() => ouvert.action(() => api.supprimerSeparation(p.id, s.id))}>Supprimer</button>
                  </td>
                </tr>
              {/each}
              {#each p.imports as i (i.id)}
                <tr>
                  <td>
                    <strong>Import · {i.quoi === "voice" ? "voice" : "bed"}</strong>
                    <div class="discret petit">
                      {i.nom}{i.decalage_ms ? ` · recalé de ${i.decalage_ms > 0 ? "+" : ""}${i.decalage_ms} ms` : ""}
                    </div>
                  </td>
                  <td class="ligne">
                    <button class="petit" class:actif={ecoute === `import:${i.id}`} onclick={() => ecouter(`import:${i.id}`)}>
                      {touche(`import:${i.id}`)}{i.quoi === "voice" ? "Voice" : "Bed"}
                    </button>
                    <a class="bouton petit" href={api.urlExport(p.id, `import-${i.id}`)} download title="Télécharger pour retoucher encore">⬇</a>
                  </td>
                  <td>
                    {#if i.quoi === "voice"}
                      <input
                        type="radio"
                        name="voice"
                        aria-label="Garder cette voice"
                        checked={estChoisie(p.voice, "import", i.id)}
                        onchange={() => ouvert.modifier({ voice: { origine: "import", import: i.id } })}
                      />
                    {/if}
                  </td>
                  <td>
                    {#if i.quoi === "bed"}
                      <input
                        type="radio"
                        name="bed"
                        aria-label="Garder ce bed"
                        checked={estChoisie(p.bed, "import", i.id)}
                        onchange={() => ouvert.modifier({ bed: { origine: "import", import: i.id } })}
                      />
                    {/if}
                  </td>
                  <td style="text-align:right">
                    <button class="discret petit danger" onclick={() => ouvert.action(() => api.supprimerImport(p.id, i.id))}>Supprimer</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="discret petit">
            Astuce : écoute le bed sur les passages parlés. S'il reste des bribes de voix, le doublage des joueurs sonnera
            faux : essaie un autre modèle (Roformer est souvent meilleur sur les dialogues), ou retouche-le.
          </p>
        </div>
      </div>
    </section>
  {/if}
{/if}

{#if analyse}
  <Modale titre="Importer {analyse.quoi === 'voice' ? 'une voice' : 'un bed'}" onfermer={() => (analyse = null)}>
    <p><code>{analyse.nom}</code></p>
    <p class="petit">
      Durée : {formaterTemps(analyse.duree_ms)} · durée de l'extrait : {formaterTemps(analyse.attendu_ms)}
    </p>
    {#if analyse.decalage_ms === null}
      <p class="message info">
        Pas de comparaison possible avec l'original (audio de la plage indisponible) : la piste est prise telle quelle.
      </p>
    {:else if Math.abs(analyse.decalage_ms) < 5}
      <p class="message ok">Calée sur l'original, pas de décalage détecté.</p>
    {:else}
      <div class="message attention pile">
        <span>
          La piste semble {analyse.decalage_ms > 0 ? "en retard" : "en avance"} de <strong>{Math.abs(analyse.decalage_ms)} ms</strong>
          sur l'original ({(analyse.confiance ?? 0) >= 0.3 ? "mesure fiable" : "mesure incertaine, à vérifier à l'écoute"}) : un
          logiciel ajoute parfois un blanc au début.
        </span>
        <label class="case">
          <input type="checkbox" bind:checked={recaler} />
          <span>Recaler de</span>
          <input class="mono decalage" type="number" step="1" bind:value={decalage} disabled={!recaler} />
          <span>ms</span>
        </label>
      </div>
    {/if}
    {#if Math.abs(ecart) > 50}
      <p class="message attention">
        La piste {ecart > 0 ? `dépasse de ${ecart} ms : la fin sera coupée` : `est trop courte de ${-ecart} ms : elle sera complétée par du silence`}.
      </p>
    {:else if ecart !== 0}
      <p class="discret petit">Écart de durée de {Math.abs(ecart)} ms : ajusté automatiquement.</p>
    {/if}
    <p class="discret petit">
      Elle sera convertie en WAV 48 kHz stéréo à la durée exacte de l'extrait, puis choisie comme {analyse.quoi}. Le même
      gain que l'autre piste lui sera appliqué à l'encodage.
    </p>
    {#snippet pied()}
      <button onclick={() => (analyse = null)}>Annuler</button>
      <button class="principal" disabled={validation} onclick={valider}>{validation ? "Mise aux normes…" : "Importer"}</button>
    {/snippet}
  </Modale>
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
  .etapes-retouche {
    margin: 0;
    padding-left: 18px;
    color: var(--texte-2);
    display: flex;
    flex-direction: column;
    gap: 3px;
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
    gap: 4px;
  }
  .decalage {
    width: 90px;
  }
</style>
