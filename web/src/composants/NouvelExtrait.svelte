<script lang="ts">
  // Étape 1 : choisir une vidéo source (glisser-déposer, explorateur ou chemin collé) et créer le projet.
  import Explorateur from "./Explorateur.svelte";
  import Modale from "./Modale.svelte";
  import { api } from "../lib/api.ts";
  import { tailleLisible } from "../lib/outils.ts";
  import { studio } from "../lib/studio.svelte.ts";
  import { identifiantValide } from "../../../commun/identifiants.ts";

  let explorateur = $state(false);
  let survol = $state(false);
  let cheminSaisi = $state("");
  let message = $state<{ texte: string; niveau: "erreur" | "info" } | null>(null);
  let candidats = $state<string[]>([]);
  let choisi = $state<string | null>(null);
  let id = $state("");
  let creation = $state(false);

  const nomFichier = (chemin: string) => chemin.split(/[\\/]/).pop() ?? chemin;

  async function choisir(chemin: string) {
    chemin = chemin.trim().replace(/^"|"$/g, "");
    if (!chemin) return;
    explorateur = false;
    candidats = [];
    choisi = chemin;
    message = null;
    try {
      id = (await api.identifiant(nomFichier(chemin))).id;
    } catch (e) {
      message = { texte: (e as Error).message, niveau: "erreur" };
    }
  }

  async function deposer(e: DragEvent) {
    e.preventDefault();
    survol = false;
    const fichier = e.dataTransfer?.files[0];
    if (!fichier) return;
    // le navigateur ne donne pas le chemin : on le retrouve par le nom et la taille
    message = { texte: `Recherche de « ${fichier.name} » dans les dossiers sources…`, niveau: "info" };
    try {
      const { chemins } = await api.chercherFichier(fichier.name, fichier.size);
      if (chemins.length === 1) await choisir(chemins[0]);
      else if (chemins.length > 1) {
        candidats = chemins;
        message = { texte: "Plusieurs fichiers correspondent : lequel ?", niveau: "info" };
      } else {
        message = {
          texte: `« ${fichier.name} » (${tailleLisible(fichier.size)}) est introuvable dans les dossiers sources. Ajoute son dossier dans les Réglages, ou utilise « Parcourir ».`,
          niveau: "erreur",
        };
      }
    } catch (err) {
      message = { texte: (err as Error).message, niveau: "erreur" };
    }
  }

  async function creer() {
    if (!choisi) return;
    creation = true;
    try {
      const projet = await api.creerProjet(choisi, id);
      choisi = null;
      studio.aller({ ecran: "projet", id: projet.id, etape: "import" });
    } catch (e) {
      message = { texte: (e as Error).message, niveau: "erreur" };
    } finally {
      creation = false;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="depot"
  class:survol
  ondragover={(e) => {
    e.preventDefault();
    survol = true;
  }}
  ondragleave={() => (survol = false)}
  ondrop={deposer}
>
  <div class="grand">Glisse une vidéo ici</div>
  <div class="discret petit">mp4, mkv, mov, webm… La source reste à sa place : rien n'est copié.</div>
  <div class="ligne centre">
    <button onclick={() => (explorateur = true)}>Parcourir…</button>
    <span class="discret petit">ou</span>
    <form
      class="ligne"
      onsubmit={(e) => {
        e.preventDefault();
        void choisir(cheminSaisi);
      }}
    >
      <input class="mono chemin" bind:value={cheminSaisi} placeholder="Coller le chemin du fichier" spellcheck="false" />
      <button type="submit" disabled={!cheminSaisi.trim()}>OK</button>
    </form>
  </div>
  {#if message}<p class="message {message.niveau}">{message.texte}</p>{/if}
  {#each candidats as c (c)}
    <button class="discret petit" onclick={() => choisir(c)}>{c}</button>
  {/each}
</div>

{#if explorateur}
  <Explorateur onfermer={() => (explorateur = false)} onchoisir={choisir} />
{/if}

{#if choisi}
  <Modale titre="Nouvel extrait" onfermer={() => (choisi = null)}>
    <div class="pile">
      <div>
        <div class="discret petit">Vidéo source</div>
        <code class="source">{choisi}</code>
      </div>
      <label class="champ">
        Identifiant de l'extrait
        <input class="mono" bind:value={id} spellcheck="false" />
      </label>
      <p class="discret petit">
        Minuscules, chiffres et tirets, par exemple <code>titanic-proue</code>. Il sert de nom de dossier et d'adresse :
        il ne pourra plus changer une fois l'extrait publié.
      </p>
      {#if id && !identifiantValide(id)}<p class="erreur petit">Identifiant invalide.</p>{/if}
      {#if message?.niveau === "erreur"}<p class="message erreur">{message.texte}</p>{/if}
    </div>
    {#snippet pied()}
      <button onclick={() => (choisi = null)}>Annuler</button>
      <button class="principal" disabled={!identifiantValide(id) || creation} onclick={creer}>
        {creation ? "Analyse de la vidéo…" : "Créer le projet"}
      </button>
    {/snippet}
  </Modale>
{/if}

<style>
  .depot {
    border: 2px dashed var(--bordure-forte);
    border-radius: var(--rayon);
    padding: 26px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .depot.survol {
    border-color: var(--or);
    background: rgba(212, 173, 90, 0.06);
  }
  .grand {
    font-size: 17px;
    font-weight: 600;
  }
  .centre {
    justify-content: center;
    margin-top: 6px;
  }
  .chemin {
    width: 340px;
    font-size: 12.5px;
  }
  .source {
    word-break: break-all;
  }
</style>
