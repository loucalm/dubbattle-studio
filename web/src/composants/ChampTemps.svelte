<script lang="ts">
  // Saisie d'un temps (« 1:02:03.456 », « 12.5 »…). La valeur n'est prise en compte qu'à la validation.
  import { formaterTemps, lireTemps } from "../../../commun/temps.ts";

  let {
    valeur,
    onchange,
    heures = false,
    largeur = "9.5em",
    desactive = false,
    etiquette,
  }: {
    valeur: number;
    onchange: (ms: number) => void;
    heures?: boolean;
    largeur?: string;
    desactive?: boolean;
    etiquette?: string;
  } = $props();

  let texte = $state("");
  let invalide = $state(false);
  let enSaisie = $state(false);

  $effect(() => {
    if (!enSaisie) texte = formaterTemps(valeur, heures);
  });

  function valider() {
    enSaisie = false;
    const ms = lireTemps(texte);
    if (ms === null) {
      invalide = true;
      return;
    }
    invalide = false;
    if (ms !== valeur) onchange(ms);
    texte = formaterTemps(ms, heures);
  }
</script>

<input
  class="mono temps"
  class:invalide
  style:width={largeur}
  bind:value={texte}
  disabled={desactive}
  aria-label={etiquette}
  onfocus={() => (enSaisie = true)}
  onblur={valider}
  onkeydown={(e) => {
    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
    if (e.key === "Escape") {
      enSaisie = false;
      texte = formaterTemps(valeur, heures);
      (e.currentTarget as HTMLInputElement).blur();
    }
    e.stopPropagation();
  }}
/>

<style>
  .temps {
    text-align: center;
  }
  .invalide {
    border-color: var(--erreur);
  }
</style>
