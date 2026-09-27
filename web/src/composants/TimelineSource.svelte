<script lang="ts">
  // Timeline de toute la source pour la découpe : forme d'onde (pics calculés par le serveur),
  // entrée et sortie déplaçables, tête de lecture. Molette : zoom ; Maj + molette ou glisser : défilement.
  import { onMount } from "svelte";
  import { formaterTemps } from "../../../commun/temps.ts";

  let {
    pics,
    picsParSeconde,
    dureeMs,
    entree,
    sortie,
    position,
    onseek,
    onentree,
    onsortie,
  }: {
    pics: Uint8Array | null;
    picsParSeconde: number;
    dureeMs: number;
    entree: number | null;
    sortie: number | null;
    position: number;
    onseek: (ms: number) => void;
    onentree: (ms: number) => void;
    onsortie: (ms: number) => void;
  } = $props();

  const HAUTEUR = 120;
  const REGLE = 20;
  const POIGNEE_PX = 7;
  const ZOOM_MIN_MS = 2000;

  let conteneur: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let largeur = $state(800);
  // svelte-ignore state_referenced_locally
  let vue = $state({ debut: 0, fin: Math.max(1000, dureeMs) });

  const msParPx = $derived((vue.fin - vue.debut) / Math.max(1, largeur));
  const versX = (ms: number) => (ms - vue.debut) / msParPx;
  const versMs = (x: number) => vue.debut + x * msParPx;

  function borner(debut: number, fin: number) {
    const etendue = Math.max(ZOOM_MIN_MS, Math.min(fin - debut, dureeMs));
    let d = Math.max(0, Math.min(debut, dureeMs - etendue));
    vue = { debut: d, fin: d + etendue };
  }

  export function toutVoir() {
    borner(0, dureeMs);
  }

  export function voirSelection() {
    if (entree === null || sortie === null) return;
    const marge = Math.max(1000, (sortie - entree) * 0.15);
    borner(entree - marge, sortie + marge);
  }

  /** Garde la tête de lecture visible pendant la lecture. */
  export function suivre(ms: number) {
    if (ms < vue.debut || ms > vue.fin) {
      const etendue = vue.fin - vue.debut;
      borner(ms - etendue * 0.1, ms + etendue * 0.9);
    }
  }

  function dessiner() {
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = largeur * ratio;
    canvas.height = HAUTEUR * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#0e0d0c";
    ctx.fillRect(0, 0, largeur, HAUTEUR);
    ctx.fillStyle = "#191715";
    ctx.fillRect(0, 0, largeur, REGLE);

    // graduations
    const pas = [100, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000];
    const intervalle = pas.find((p) => p / msParPx >= 90) ?? 3_600_000;
    ctx.font = "11px Segoe UI, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (let t = Math.floor(vue.debut / intervalle) * intervalle; t <= vue.fin; t += intervalle) {
      const x = Math.round(versX(t)) + 0.5;
      ctx.strokeStyle = "#2a2723";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, HAUTEUR);
      ctx.stroke();
      ctx.fillStyle = "#8a8378";
      const texte = formaterTemps(t, dureeMs >= 3_600_000);
      ctx.fillText(intervalle >= 1000 ? texte.replace(/\.000$/, "") : texte, x + 4, REGLE / 2);
    }

    // forme d'onde
    const milieu = REGLE + (HAUTEUR - REGLE) / 2;
    const amplitude = (HAUTEUR - REGLE) / 2 - 4;
    if (pics) {
      ctx.fillStyle = "#7c7568";
      for (let x = 0; x < largeur; x++) {
        const a = Math.floor((versMs(x) / 1000) * picsParSeconde);
        const b = Math.max(a + 1, Math.floor((versMs(x + 1) / 1000) * picsParSeconde));
        let max = 0;
        for (let i = Math.max(0, a); i < Math.min(pics.length, b); i++) if (pics[i] > max) max = pics[i];
        // racine : les dialogues restent visibles à côté des passages forts
        const h = Math.max(1, Math.sqrt(max / 255) * amplitude);
        ctx.fillRect(x, milieu - h, 1, h * 2);
      }
    }

    // sélection
    if (entree !== null && sortie !== null) {
      const x0 = versX(entree);
      const x1 = versX(sortie);
      ctx.fillStyle = "rgba(212, 173, 90, 0.16)";
      ctx.fillRect(x0, REGLE, x1 - x0, HAUTEUR - REGLE);
    }
    for (const [t, lettre] of [
      [entree, "E"],
      [sortie, "S"],
    ] as const) {
      if (t === null) continue;
      const x = Math.round(versX(t)) + 0.5;
      ctx.strokeStyle = "#d4ad5a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, REGLE);
      ctx.lineTo(x, HAUTEUR);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = "#d4ad5a";
      ctx.fillRect(lettre === "E" ? x : x - 14, REGLE, 14, 14);
      ctx.fillStyle = "#1b160c";
      ctx.font = "bold 10px Segoe UI, sans-serif";
      ctx.fillText(lettre, lettre === "E" ? x + 3.5 : x - 10.5, REGLE + 7.5);
    }

    // tête de lecture
    const xp = Math.round(versX(position)) + 0.5;
    ctx.strokeStyle = "#f4efe6";
    ctx.beginPath();
    ctx.moveTo(xp, 0);
    ctx.lineTo(xp, HAUTEUR);
    ctx.stroke();
  }

  $effect(() => {
    // redessiner quand l'une de ces valeurs change
    void [pics, vue, largeur, entree, sortie, position];
    dessiner();
  });

  onMount(() => {
    const ro = new ResizeObserver(() => (largeur = conteneur.clientWidth));
    ro.observe(conteneur);
    largeur = conteneur.clientWidth;
    return () => ro.disconnect();
  });

  // ---- interactions ----
  type Glisse = { mode: "entree" | "sortie" | "defiler"; x0: number; vue0: typeof vue; bouge: boolean } | null;
  let glisse: Glisse = null;

  function localX(e: PointerEvent | WheelEvent) {
    return e.clientX - canvas.getBoundingClientRect().left;
  }

  function appui(e: PointerEvent) {
    canvas.setPointerCapture(e.pointerId);
    const x = localX(e);
    let mode: "entree" | "sortie" | "defiler" = "defiler";
    if (entree !== null && Math.abs(x - versX(entree)) <= POIGNEE_PX) mode = "entree";
    else if (sortie !== null && Math.abs(x - versX(sortie)) <= POIGNEE_PX) mode = "sortie";
    glisse = { mode, x0: x, vue0: { ...vue }, bouge: false };
  }

  function deplacement(e: PointerEvent) {
    const x = localX(e);
    if (!glisse) {
      const proche =
        (entree !== null && Math.abs(x - versX(entree)) <= POIGNEE_PX) ||
        (sortie !== null && Math.abs(x - versX(sortie)) <= POIGNEE_PX);
      canvas.style.cursor = proche ? "ew-resize" : "default";
      return;
    }
    if (Math.abs(x - glisse.x0) > 3) glisse.bouge = true;
    if (!glisse.bouge) return;
    const t = Math.max(0, Math.min(dureeMs, versMs(x)));
    if (glisse.mode === "entree") onentree(t);
    else if (glisse.mode === "sortie") onsortie(t);
    else {
      const decalage = (glisse.x0 - x) * ((glisse.vue0.fin - glisse.vue0.debut) / largeur);
      borner(glisse.vue0.debut + decalage, glisse.vue0.fin + decalage);
    }
  }

  function relache(e: PointerEvent) {
    if (glisse && !glisse.bouge) onseek(Math.max(0, Math.min(dureeMs, versMs(localX(e)))));
    glisse = null;
  }

  function molette(e: WheelEvent) {
    e.preventDefault();
    const etendue = vue.fin - vue.debut;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = ((e.shiftKey ? e.deltaY : e.deltaX) / largeur) * etendue;
      borner(vue.debut + d, vue.fin + d);
      return;
    }
    const facteur = e.deltaY < 0 ? 1 / 1.25 : 1.25;
    const ancre = versMs(localX(e));
    const nouvelle = Math.max(ZOOM_MIN_MS, Math.min(dureeMs, etendue * facteur));
    const part = (ancre - vue.debut) / etendue;
    borner(ancre - part * nouvelle, ancre - part * nouvelle + nouvelle);
  }
</script>

<div class="timeline" bind:this={conteneur}>
  <canvas
    bind:this={canvas}
    style:height="{HAUTEUR}px"
    onpointerdown={appui}
    onpointermove={deplacement}
    onpointerup={relache}
    onwheel={molette}
  ></canvas>
  {#if !pics}<div class="attente discret petit">Forme d'onde en préparation…</div>{/if}
</div>

<style>
  .timeline {
    position: relative;
    width: 100%;
    border: 1px solid var(--bordure);
    border-radius: var(--rayon-petit);
    overflow: hidden;
  }
  canvas {
    display: block;
    width: 100%;
    touch-action: none;
  }
  .attente {
    position: absolute;
    right: 8px;
    bottom: 6px;
  }
</style>
