<script lang="ts">
  // Étape 1 : la vidéo source (infos ffprobe, empreinte, piste audio), l'identifiant du projet.
  import BarreTache from "../composants/BarreTache.svelte";
  import EnteteEtape from "../composants/EnteteEtape.svelte";
  import Explorateur from "../composants/Explorateur.svelte";
  import SuppressionExtrait from "../composants/SuppressionExtrait.svelte";
  import { api } from "../lib/api.ts";
  import { tailleLisible } from "../lib/outils.ts";
  import type { ProjetOuvert } from "../lib/projet.svelte.ts";
  import { studio } from "../lib/studio.svelte.ts";
  import { formaterDuree } from "../../../commun/temps.ts";

  let { ouvert }: { ouvert: ProjetOuvert } = $props();

  const d = $derived(ouvert.detail!);
  const p = $derived(d.projet);
  const s = $derived(p.source);
  let relier = $state(false);
  let suppression = $state(false);

  const tachesSource = $derived(
    (["empreinte", "pics", "apercu", "recherche_source"] as const)
      .map((t) => studio.derniereTache(p.id, t))
      .filter((t) => t !== undefined),
  );

  async function choisirSource() {
    if (!studio.serveur?.dialogues_natifs) {
      relier = true;
      return;
    }
    try {
      const { chemin } = await api.dialogue("video", "Retrouver la vidéo source");
      if (chemin) await ouvert.action(() => api.relierSource(p.id, chemin), "Source reliée.");
    } catch {
      relier = true;
    }
  }


  const nomLangue = (code: string | null) =>
    ({ fre: "français", fra: "français", eng: "anglais", spa: "espagnol", ger: "allemand", deu: "allemand", ita: "italien", jpn: "japonais" })[
      code ?? ""
    ] ??
    code ??
    "langue inconnue";
</script>

<EnteteEtape etape="import" id={p.id} description="La vidéo source reste à sa place. Le Studio garde son empreinte pour la retrouver si elle est déplacée ou renommée." />

<div class="grille">
  <section class="panneau pile">
    <h2>Vidéo source</h2>
    {#if !d.source_presente}
      <div class="message attention pile">
        <strong>Source introuvable{s.chemin ? ` : ${s.chemin}` : ""}.</strong>
        <span>
          Tout ce qui ne touche que les JSON (répliques, infos) reste modifiable. Pour la découpe, la séparation ou
          l'encodage, relie la source.
        </span>
        <div class="ligne">
          <button onclick={() => ouvert.action(() => api.relierSource(p.id))} disabled={!s.empreinte}>Chercher dans les dossiers sources</button>
          <button onclick={choisirSource}>Choisir le fichier…</button>
        </div>
      </div>
    {/if}
    <table>
      <tbody>
        <tr><th>Fichier</th><td class="mono petit chemin">{s.chemin || s.nom}</td></tr>
        <tr><th>Taille</th><td>{tailleLisible(s.taille_octets)}</td></tr>
        <tr><th>Durée</th><td>{formaterDuree(s.duree_ms)}</td></tr>
        {#if s.video.largeur}
          <tr>
            <th>Image</th>
            <td>
              {s.video.largeur}×{s.video.hauteur} · {s.video.ips.toLocaleString("fr-FR")} i/s · {s.video.codec}
              {s.video.format_pixels}{s.video.entrelacee ? " · entrelacée (désentrelacée à l'encodage)" : ""}
            </td>
          </tr>
          <tr><th>Conteneur</th><td>{s.conteneur}{s.debut_ms ? ` · début à ${s.debut_ms} ms` : ""}</td></tr>
        {/if}
        <tr>
          <th>Empreinte</th>
          <td class="mono petit">{s.empreinte ? `${s.empreinte.slice(0, 23)}…` : "en cours de calcul…"}</td>
        </tr>
      </tbody>
    </table>
    {#if tachesSource.length > 0}
      <div class="pile">
        {#each tachesSource as t (t.id)}
          <div>
            <div class="petit">{t.libelle}</div>
            <BarreTache tache={t} />
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="panneau pile">
    <h2>Piste audio</h2>
    {#if s.pistes_audio.length === 0}
      <p class="discret">
        {d.source_presente ? "Cette vidéo n'a pas de piste audio." : "Pistes inconnues tant que la source n'est pas reliée."}
      </p>
    {:else}
      <p class="discret petit">La piste dont on sépare la voix et le fond. Changer de piste oblige à refaire la séparation.</p>
      {#each s.pistes_audio as piste (piste.rang)}
        <label class="case piste">
          <input
            type="radio"
            name="piste"
            checked={p.piste_audio === piste.rang}
            onchange={() => ouvert.modifier({ piste_audio: piste.rang })}
          />
          <span>
            <strong>{piste.titre ?? `Piste ${piste.rang + 1}`}</strong>
            <span class="discret">· {nomLangue(piste.langue)} · {piste.codec} · {piste.canaux} canaux</span>
          </span>
        </label>
      {/each}
    {/if}

    <h2 class="espace-haut">Identifiant</h2>
    <p><code>{p.id}</code></p>
    {#if p.publication}
      <p class="discret petit">Déjà publié : l'identifiant ne change plus.</p>
    {:else}
      <p class="discret petit">
        Tiré du titre (étape 5) : il le suit jusqu'à la première publication, puis ne change plus. C'est le nom du dossier
        publié et l'adresse de l'extrait.
      </p>
    {/if}

    <h2 class="espace-haut">Projet</h2>
    <div><button class="danger" onclick={() => (suppression = true)}>Supprimer…</button></div>
  </section>
</div>

{#if suppression}
  <SuppressionExtrait
    id={p.id}
    titre={p.infos.titre}
    projet={true}
    publie={d.publie}
    onfermer={() => (suppression = false)}
    onfini={(fait) => {
      suppression = false;
      if (fait.projet) studio.aller({ ecran: "bibliotheque" });
      else ouvert.notifier("Retrait du jeu lancé.", "ok");
    }}
  />
{/if}

{#if relier}
  <Explorateur
    titre="Retrouver la vidéo source"
    onfermer={() => (relier = false)}
    onchoisir={(chemin) => {
      relier = false;
      void ouvert.action(() => api.relierSource(p.id, chemin), "Source reliée.");
    }}
  />
{/if}

<style>
  .grille {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  th {
    width: 110px;
    border: none;
    padding-left: 0;
  }
  td {
    border: none;
  }
  .chemin {
    word-break: break-all;
  }
  .piste {
    align-items: flex-start;
  }
  .espace-haut {
    margin-top: 10px;
  }
</style>
