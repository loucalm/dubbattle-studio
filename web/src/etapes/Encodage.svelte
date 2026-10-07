<script lang="ts">
  // Étape 6 : un seul encodage depuis la source (fiche 7.8). Seul ce qui a changé est refait.
  import BarreTache from "../composants/BarreTache.svelte";
  import EnteteEtape from "../composants/EnteteEtape.svelte";
  import { api } from "../lib/api.ts";
  import { dateLisible, tailleLisible } from "../lib/outils.ts";
  import type { ProjetOuvert } from "../lib/projet.svelte.ts";
  import { studio } from "../lib/studio.svelte.ts";
  import {
    DEBITS_BED_POSSIBLES,
    DEBITS_VOICE_POSSIBLES,
    estimerTailles,
    ipsCible,
    REGLAGES_ENCODAGE_DEFAUT,
    TAILLE_MAX_FICHIER,
  } from "../../../commun/encodage.ts";
  import { dureeExtrait } from "../../../commun/publication.ts";
  import { FICHIERS_MEDIAS, MEDIAS, type Media, type ReglagesEncodage } from "../../../commun/types.ts";

  let { ouvert }: { ouvert: ProjetOuvert } = $props();

  const d = $derived(ouvert.detail!);
  const p = $derived(d.projet);
  // svelte-ignore state_referenced_locally
  let reglages = $state<ReglagesEncodage>({ ...p.encodage });
  let recaler = $state(true);

  const descriptions = $derived<Record<Media, string>>({
    video: "H.264 High, sans audio, CRF, image clé chaque seconde et au début de chaque réplique, faststart",
    voice: `AAC mono 48 kHz, ${p.encodage.voice_kbps} kbps`,
    bed: `AAC stéréo 48 kHz, ${p.encodage.bed_kbps} kbps`,
    vignette: "WebP 640 px, qualité 80",
  });

  const tache = $derived(studio.derniereTache(p.id, "encodage"));
  const enCours = $derived(tache?.etat === "en_cours" || tache?.etat === "attente");
  const etats = $derived(d.etats_medias);
  const imagesCles = $derived(etats.video.etat === "images_cles");
  const aFaire = $derived(d.a_encoder.length > 0 || (imagesCles && recaler));
  const bloque = $derived(MEDIAS.some((m) => etats[m].etat === "bloque"));
  const modifies = $derived(
    reglages.hauteur !== p.encodage.hauteur ||
      reglages.crf !== p.encodage.crf ||
      reglages.debit_max !== p.encodage.debit_max ||
      reglages.voice_kbps !== p.encodage.voice_kbps ||
      reglages.bed_kbps !== p.encodage.bed_kbps,
  );

  const estimation = $derived(
    estimerTailles(dureeExtrait(p), { ...reglages, crf: Number(reglages.crf) || 26 }, p.source.video),
  );

  function libelleEtat(m: Media): { texte: string; classe: string } {
    const e = etats[m];
    switch (e.etat) {
      case "a_jour":
        return { texte: "À jour", classe: "ok" };
      case "images_cles":
        return { texte: "À jour (images clés décalées)", classe: "attention" };
      case "manquant":
        return { texte: "À encoder", classe: "" };
      case "a_refaire":
        return { texte: "À refaire", classe: "attention" };
      case "bloque":
        return { texte: e.raison, classe: "erreur" };
    }
  }
</script>

<EnteteEtape
  etape="encodage"
  id={p.id}
  description="Un seul encodage, directement depuis la source : pas de double compression. Seuls les fichiers dont la recette a changé sont refaits."
/>

<div class="grille">
  <section class="panneau pile">
    <h2>Fichiers</h2>
    <table>
      <thead><tr><th>Fichier</th><th>État</th><th>Taille</th></tr></thead>
      <tbody>
        {#each MEDIAS as m (m)}
          {@const e = libelleEtat(m)}
          {@const sortie = p.sortie[m]}
          <tr>
            <td>
              <strong class="mono">{FICHIERS_MEDIAS[m]}</strong>
              <div class="discret petit">{descriptions[m]}</div>
            </td>
            <td class={e.classe}>{e.texte}</td>
            <td class:erreur={!!sortie && sortie.taille_octets > TAILLE_MAX_FICHIER}>
              {sortie ? tailleLisible(sortie.taille_octets) : "—"}
              {#if sortie}<div class="discret petit">{sortie.encode_le ? dateLisible(sortie.encode_le) : ""}</div>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>

    {#if imagesCles}
      <label class="case">
        <input type="checkbox" bind:checked={recaler} />
        <span>
          Réencoder la vidéo pour placer les images clés sur les nouveaux débuts de répliques
          <span class="discret petit">(pas obligatoire : il y a de toute façon une image clé par seconde)</span>
        </span>
      </label>
    {/if}

    <div class="ligne">
      <button class="principal" disabled={!aFaire || bloque || enCours || modifies} onclick={() => ouvert.action(() => api.encoder(p.id, recaler))}>
        {enCours ? "Encodage en cours…" : aFaire ? "Encoder" : "Tout est à jour"}
      </button>
      {#if modifies}<span class="attention petit">Enregistre d'abord les réglages.</span>{/if}
      {#if !d.source_presente && (d.a_encoder.includes("video") || d.a_encoder.includes("vignette"))}
        <span class="erreur petit">La vidéo source est introuvable (étape 1).</span>
      {/if}
    </div>
    {#if tache && (enCours || tache.etat === "erreur")}<BarreTache {tache} />{/if}
  </section>

  <section class="panneau pile">
    <h2>Réglages</h2>
    <label class="champ">
      Hauteur maximale
      <select bind:value={reglages.hauteur}>
        <option value={720}>720p (par défaut)</option>
        <option value={480}>480p (sources de faible qualité)</option>
      </select>
    </label>
    <label class="champ">
      CRF (qualité constante)
      <input type="number" min="16" max="36" bind:value={reglages.crf} />
    </label>
    <p class="discret petit explication">
      Plus le nombre est bas, plus l'image est belle et le fichier lourd. 18 : aucune perte visible · 23 : très bon ·
      <strong>26 : bon compromis (fiche)</strong> · 30 : perte visible sur les détails. Chaque +6 divise à peu près la
      taille par deux.
    </p>
    <label class="champ">
      Débit maximal
      <input bind:value={reglages.debit_max} class="mono" />
    </label>
    <p class="discret petit explication">
      Plafond du débit vidéo, en bits par seconde (2M = 2 Mbit/s). Sur les scènes très agitées (explosions, confettis,
      grain), l'encodeur ne le dépasse pas : la qualité y baisse un peu, mais la taille reste garantie (2M ≈ 15 Mo par
      minute au pire).
    </p>
    <label class="champ">
      Débit de la voice (mono)
      <select bind:value={reglages.voice_kbps}>
        {#each DEBITS_VOICE_POSSIBLES as kbps (kbps)}
          <option value={kbps}>{kbps} kbps{kbps === REGLAGES_ENCODAGE_DEFAUT.voice_kbps ? " (par défaut)" : ""}</option>
        {/each}
      </select>
    </label>
    <label class="champ">
      Débit du bed (stéréo)
      <select bind:value={reglages.bed_kbps}>
        {#each DEBITS_BED_POSSIBLES as kbps (kbps)}
          <option value={kbps}>{kbps} kbps{kbps === REGLAGES_ENCODAGE_DEFAUT.bed_kbps ? " (par défaut)" : ""}</option>
        {/each}
      </select>
    </label>
    <p class="discret petit explication">
      Un débit plus bas allège le téléchargement (environ 0,35 Mo par minute de voice à 48 kbps, 0,7 Mo de bed à 96 kbps)
      mais pas la mémoire du jeu, qui décode le son en PCM. Sous 40 kbps pour la voice ou 80 kbps pour le bed, le son
      devient métallique. Seuls les fichiers audio sont refaits.
    </p>
    <div class="estimation">
      <div class="ligne">
        <span class="discret">Taille estimée</span>
        <span class="espaceur"></span>
        <strong>≈ {tailleLisible(estimation.video_probable + estimation.audio)}</strong>
      </div>
      <div class="discret petit">
        vidéo ≈ {tailleLisible(estimation.video_probable)} (au plus {tailleLisible(estimation.video_max)}) · voice et bed
        {tailleLisible(estimation.audio)}
      </div>
      <div class="discret petit">
        Estimation : la taille réelle dépend de l'image (beaucoup de mouvement = plus lourd). Limite Cloudflare Pages : 25
        Mo par fichier.
      </div>
      {#if estimation.video_max > TAILLE_MAX_FICHIER}
        <div class="attention petit">Au pire, la vidéo pourrait dépasser 25 Mo : baisse le débit maximal ou raccourcis l'extrait.</div>
      {/if}
    </div>
    <p class="discret petit">
      Source : {p.source.video.hauteur ? `${p.source.video.largeur}×${p.source.video.hauteur}, ` : ""}{p.source.video.ips.toLocaleString("fr-FR")} i/s
      → {ipsCible(p.source.video.ips).toLocaleString("fr-FR")} i/s encodées (30 au plus).
    </p>
    <div class="ligne">
      <button disabled={!modifies} onclick={() => ouvert.modifier({ encodage: { ...reglages, crf: Number(reglages.crf) } })}>Enregistrer les réglages</button>
      <button class="discret" onclick={() => (reglages = { ...REGLAGES_ENCODAGE_DEFAUT })}>Valeurs de la fiche</button>
    </div>
  </section>
</div>

<style>
  .grille {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .explication {
    margin-top: -6px;
  }
  .estimation {
    background: var(--fond-2);
    border: 1px solid var(--bordure);
    border-radius: var(--rayon-petit);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  td.ok {
    color: var(--ok);
  }
  td.attention {
    color: var(--attention);
  }
  td.erreur {
    color: var(--erreur);
  }
</style>
