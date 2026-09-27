<script lang="ts">
  // Étape 8 : écrire dans ../extraits, régénérer le catalogue, commit et push. On montre
  // toujours ce qui va être publié avant de pousser.
  import { onMount } from "svelte";
  import BarreTache from "../composants/BarreTache.svelte";
  import EnteteEtape from "../composants/EnteteEtape.svelte";
  import Modale from "../composants/Modale.svelte";
  import { api } from "../lib/api.ts";
  import { tailleLisible } from "../lib/outils.ts";
  import type { ProjetOuvert } from "../lib/projet.svelte.ts";
  import { studio } from "../lib/studio.svelte.ts";
  import type { ApercuPublication } from "../../../commun/types.ts";

  let { ouvert }: { ouvert: ProjetOuvert } = $props();

  const d = $derived(ouvert.detail!);
  const p = $derived(d.projet);

  let apercu = $state<ApercuPublication | null>(null);
  let chargement = $state(false);
  let message = $state("");
  let pousser = $state(true);
  let confirmation = $state(false);

  async function charger() {
    chargement = true;
    apercu = await ouvert.action(() => api.apercuPublication(p.id));
    if (apercu) message = apercu.message;
    chargement = false;
  }
  onMount(() => void charger());

  const taches = $derived(
    [studio.derniereTache(p.id, "publication"), studio.derniereTache(p.id, "deploiement")].filter((t) => t !== undefined),
  );
  const enCours = $derived(!!studio.tacheActive(p.id, "publication"));

  // à la fin d'une publication, l'aperçu change
  let dernierEtat = "";
  $effect(() => {
    const t = studio.derniereTache(p.id, "publication");
    const etat = t ? `${t.id}:${t.etat}` : "";
    if (dernierEtat && etat !== dernierEtat && !enCours) void charger();
    dernierEtat = etat;
  });

  async function publier() {
    confirmation = false;
    await ouvert.action(() => api.publier(p.id, message, pousser));
  }

  const changes = $derived(apercu?.fichiers.filter((f) => f.etat !== "inchange") ?? []);
  const url = $derived(`${studio.serveur?.url_extraits ?? ""}/extraits/${p.id}/info.json`);
  const libelles = { ajoute: "ajouté", modifie: "modifié", inchange: "inchangé" };
</script>

<EnteteEtape
  etape="publication"
  id={p.id}
  description="Écrit les fichiers dans le dépôt des extraits, régénère catalogue.json, puis commit et push. Cloudflare Pages déploie ensuite tout seul (environ 1 min)."
>
  {#snippet actions()}
    <button onclick={charger} disabled={chargement}>{chargement ? "…" : "Actualiser"}</button>
  {/snippet}
</EnteteEtape>

{#if apercu}
  <div class="grille">
    <section class="panneau pile">
      <h2>{apercu.nouveau ? "Nouvel extrait" : "Mise à jour"} · version des médias {apercu.version_medias}</h2>
      <table>
        <thead><tr><th>Fichier</th><th>État</th><th>Taille</th></tr></thead>
        <tbody>
          {#each apercu.fichiers as f (f.chemin)}
            <tr class:inchange={f.etat === "inchange"}>
              <td class="mono petit">{f.chemin}</td>
              <td class:ok={f.etat === "ajoute"} class:attention={f.etat === "modifie"}>{libelles[f.etat]}</td>
              <td class="discret">{f.chemin === "catalogue.json" ? "régénéré" : tailleLisible(f.taille_octets)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if !apercu.nouveau && apercu.version_medias === p.publication?.version_medias}
        <p class="discret petit">Aucun média ne change : les joueurs ne retéléchargeront que les JSON.</p>
      {/if}
    </section>

    <section class="panneau pile">
      <h2>Publier</h2>
      {#each apercu.erreurs as e, i (i)}<p class="message erreur">{e}</p>{/each}
      {#each apercu.avertissements as a, i (i)}<p class="message attention">{a}</p>{/each}
      {#if apercu.depot.modifications_etrangeres.length > 0}
        <p class="message attention">
          D'autres fichiers sont modifiés dans le dépôt des extraits ({apercu.depot.modifications_etrangeres.slice(0, 4).join(", ")}{apercu.depot.modifications_etrangeres.length > 4 ? "…" : ""}).
          Ils ne feront pas partie de ce commit.
        </p>
      {/if}
      <label class="champ">
        Message du commit
        <input bind:value={message} class="mono" />
      </label>
      <label class="case">
        <input type="checkbox" bind:checked={pousser} />
        <span>Pousser vers GitHub (branche <code>{apercu.depot.branche ?? "?"}</code>)</span>
      </label>
      <div class="ligne">
        <button class="principal" disabled={apercu.erreurs.length > 0 || enCours || !message.trim() || changes.length === 0} onclick={() => (confirmation = true)}>
          Publier…
        </button>
      </div>
      {#each taches as t (t.id)}
        <div class="pile tache">
          <span class="petit">{t.libelle}</span>
          <BarreTache tache={t} />
        </div>
      {/each}
      {#if p.publication}
        <p class="discret petit">
          Dernière publication : version {p.publication.version_medias}{p.publication.commit ? `, commit ${p.publication.commit}` : ""}.
          <a href={url} target="_blank" rel="noreferrer">Voir en ligne</a>
        </p>
      {/if}
    </section>
  </div>
{:else if !chargement}
  <p class="discret">Aperçu indisponible.</p>
{/if}

{#if confirmation && apercu}
  <Modale titre="Publier {p.id} ?" onfermer={() => (confirmation = false)}>
    <p>{changes.length} fichier(s) {pousser ? "seront commités et poussés sur GitHub" : "seront commités (sans push)"} :</p>
    <ul class="mono petit">
      {#each changes as f (f.chemin)}<li>{f.chemin} <span class="discret">({libelles[f.etat]})</span></li>{/each}
    </ul>
    <p class="petit">Message : <code>{message}</code></p>
    {#snippet pied()}
      <button onclick={() => (confirmation = false)}>Annuler</button>
      <button class="principal" onclick={publier}>{pousser ? "Publier et pousser" : "Commiter"}</button>
    {/snippet}
  </Modale>
{/if}

<style>
  .grille {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  tr.inchange td {
    color: var(--texte-3);
  }
  td.ok {
    color: var(--ok);
  }
  td.attention {
    color: var(--attention);
  }
  .tache {
    gap: 4px;
  }
  ul {
    margin: 0;
    padding-left: 18px;
  }
</style>
