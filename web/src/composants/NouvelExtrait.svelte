<script lang="ts">
  // Étape 1 : choisir une vidéo source (fenêtre « Ouvrir » de Windows, glisser-déposer ou chemin
  // collé), lui donner un titre, et créer le projet. L'identifiant est tiré du titre.
  import Explorateur from "./Explorateur.svelte";
  import Modale from "./Modale.svelte";
  import { api } from "../lib/api.ts";
  import { tailleLisible } from "../lib/outils.ts";
  import { studio } from "../lib/studio.svelte.ts";
  import { versIdentifiant } from "../../../commun/identifiants.ts";

  let explorateur = $state(false);
  let survol = $state(false);
  let cheminSaisi = $state("");
  let message = $state<{ texte: string; niveau: "erreur" | "info" } | null>(null);
  let candidats = $state<string[]>([]);
  let introuvable = $state<File | null>(null);
  let copie = $state<number | null>(null);
  let choisi = $state<string | null>(null);
  let titre = $state("");
  let creation = $state(false);

  const nomFichier = (chemin: string) => chemin.split(/[\\/]/).pop() ?? chemin;
  const identifiant = $derived(versIdentifiant(titre));

  function choisir(chemin: string) {
    chemin = chemin.trim().replace(/^"|"$/g, "");
    if (!chemin) return;
    explorateur = false;
    candidats = [];
    introuvable = null;
    message = null;
    choisi = chemin;
    // titre proposé : le nom du fichier, sans extension ni séparateurs
    titre = nomFichier(chemin)
      .replace(/\.[^.]+$/, "")
      .replace(/[._]+/g, " ")
      .trim()
      .slice(0, 100);
  }

  async function parcourir() {
    if (!studio.serveur?.dialogues_natifs) {
      explorateur = true;
      return;
    }
    try {
      const { chemin } = await api.dialogue("video", "Choisir une vidéo source");
      if (chemin) choisir(chemin);
    } catch {
      explorateur = true;
    }
  }

  async function deposer(e: DragEvent) {
    e.preventDefault();
    survol = false;
    const fichier = e.dataTransfer?.files[0];
    if (!fichier) return;
    candidats = [];
    introuvable = null;
    // le navigateur ne donne jamais le chemin d'un fichier déposé : on le retrouve par nom et taille
    message = { texte: `Recherche de « ${fichier.name} »…`, niveau: "info" };
    try {
      const { chemins } = await api.chercherFichier(fichier.name, fichier.size);
      if (chemins.length === 1) choisir(chemins[0]);
      else if (chemins.length > 1) {
        candidats = chemins;
        message = { texte: "Plusieurs fichiers correspondent : lequel ?", niveau: "info" };
      } else {
        introuvable = fichier;
        message = null;
      }
    } catch (err) {
      message = { texte: (err as Error).message, niveau: "erreur" };
    }
  }

  async function copier() {
    if (!introuvable) return;
    copie = 0;
    try {
      const { chemin } = await api.televerser(introuvable, (v) => (copie = v));
      choisir(chemin);
    } catch (e) {
      message = { texte: (e as Error).message, niveau: "erreur" };
    } finally {
      copie = null;
    }
  }

  async function creer() {
    if (!choisi || !titre.trim()) return;
    creation = true;
    try {
      const projet = await api.creerProjet(choisi, titre.trim());
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
    <button class="principal" onclick={parcourir}>Parcourir…</button>
    <span class="discret petit">ou</span>
    <form
      class="ligne"
      onsubmit={(e) => {
        e.preventDefault();
        choisir(cheminSaisi);
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
  {#if introuvable}
    <div class="message attention pile introuvable">
      <span>
        « {introuvable.name} » n'est ni dans tes dossiers Téléchargements, Vidéos, Bureau et Documents, ni dans les
        dossiers sources des Réglages. Le navigateur ne donne pas l'emplacement d'un fichier glissé.
      </span>
      <div class="ligne">
        <button onclick={parcourir}>Le retrouver avec Parcourir…</button>
        <button onclick={copier} disabled={copie !== null}>
          {copie !== null ? `Copie… ${Math.round(copie * 100)} %` : `Copier la vidéo dans le Studio (${tailleLisible(introuvable.size)})`}
        </button>
      </div>
    </div>
  {/if}
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
        Titre de l'extrait
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={titre} maxlength="100" autofocus onkeydown={(e) => e.key === "Enter" && creer()} />
      </label>
      <p class="discret petit">
        Identifiant : <code>{identifiant || "…"}</code>. Tiré du titre, il sert de nom de dossier et d'adresse. Il suit
        le titre jusqu'à la première publication, puis ne change plus.
      </p>
      {#if message?.niveau === "erreur"}<p class="message erreur">{message.texte}</p>{/if}
    </div>
    {#snippet pied()}
      <button onclick={() => (choisi = null)}>Annuler</button>
      <button class="principal" disabled={!identifiant || creation} onclick={creer}>
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
  .introuvable {
    max-width: 640px;
    text-align: left;
  }
</style>
