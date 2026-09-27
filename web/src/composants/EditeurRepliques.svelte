<script lang="ts">
  // Éditeur de répliques sur la forme d'onde de la voice, repris de la V2 (RegionEditor.tsx).
  // Glisser sur une zone vide : nouvelle réplique · glisser un bord : l'étirer · glisser le corps :
  // la déplacer · clic : la sélectionner · clic sur la règle : se placer. Ctrl + molette : zoom.
  import { onMount } from "svelte";
  import { picsTampon } from "../lib/outils.ts";
  import { couleurPersonnage } from "../../../commun/couleurs.ts";
  import type { Personnage, Replique } from "../../../commun/types.ts";

  let {
    tampon,
    dureeMs,
    repliques,
    personnages,
    selection,
    position,
    enLecture,
    survol = true,
    onselect,
    onchange,
    onfin,
    oncreate,
    onseek,
  }: {
    tampon: AudioBuffer | null;
    dureeMs: number;
    repliques: Replique[];
    personnages: Personnage[];
    selection: number | null;
    position: number;
    enLecture: boolean;
    /** montre la réplique sous la souris */
    survol?: boolean;
    onselect: (id: number | null) => void;
    onchange: (id: number, debut: number, fin: number) => void;
    /** fin d'un glisser : le moment d'enregistrer */
    onfin: () => void;
    oncreate: (debut: number, fin: number) => void;
    onseek: (ms: number) => void;
  } = $props();

  const HAUTEUR = 190;
  const REGLE = 22;
  const MIN_MS = 120;
  const POIGNEE_PX = 7;
  const SEUIL_PX = 3;
  const PX_S_MIN = 4;
  const PX_S_MAX = 600;
  const LARGEUR_MAX = 20_000;

  let enveloppe = $state<HTMLDivElement | null>(null);
  let defilement: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let survolee = $state<{ id: number; x: number; y: number } | null>(null);
  const repliqueSurvolee = $derived(survolee ? repliques.find((r) => r.id === survolee!.id) ?? null : null);
  let largeurVue = $state(800);
  let pxParS = $state(40);
  let ajuste = false;
  let provisoire = $state<{ debut: number; fin: number } | null>(null);

  const largeur = $derived(Math.min(LARGEUR_MAX, Math.max(largeurVue, Math.round((dureeMs / 1000) * pxParS))));
  const pxParMs = $derived(largeur / Math.max(1, dureeMs));
  const versX = (ms: number) => ms * pxParMs;
  const borner = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

  const couleur = (id: string) => couleurPersonnage(personnages.findIndex((p) => p.id === id));

  /** Couloirs : les répliques qui se chevauchent sont dessinées l'une sous l'autre. */
  const couloirs = $derived.by(() => {
    const triees = [...repliques].sort((a, b) => a.debut_ms - b.debut_ms);
    const fins: number[] = [];
    const resultat = new Map<number, number>();
    for (const r of triees) {
      let c = fins.findIndex((f) => f <= r.debut_ms + 1);
      if (c === -1) {
        c = fins.length;
        fins.push(r.fin_ms);
      } else fins[c] = r.fin_ms;
      resultat.set(r.id, c);
    }
    return { parId: resultat, nombre: Math.max(1, fins.length) };
  });

  const pics = $derived(tampon ? picsTampon(tampon, Math.min(8000, Math.max(400, Math.round(largeur / 2)))) : null);

  function dessiner() {
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = largeur * ratio;
    canvas.height = HAUTEUR * ratio;
    canvas.style.width = `${largeur}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#0e0d0c";
    ctx.fillRect(0, 0, largeur, HAUTEUR);
    ctx.fillStyle = "#191715";
    ctx.fillRect(0, 0, largeur, REGLE);

    // règle
    const pas = [50, 100, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000];
    const intervalle = pas.find((p) => p * pxParMs >= 74) ?? 120_000;
    ctx.font = "11px Segoe UI, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (let t = 0; t <= dureeMs; t += intervalle) {
      const x = Math.round(versX(t)) + 0.5;
      ctx.strokeStyle = "#2a2723";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, HAUTEUR);
      ctx.stroke();
      ctx.fillStyle = "#8a8378";
      ctx.fillText(intervalle < 1000 ? (t / 1000).toFixed(2) : `${Math.floor(t / 60000) > 0 ? `${Math.floor(t / 60000)}:${String(Math.round((t % 60000) / 1000)).padStart(2, "0")}` : `${t / 1000}s`}`, x + 4, REGLE / 2);
    }

    // forme d'onde de la voice
    if (pics) {
      const milieu = REGLE + (HAUTEUR - REGLE) / 2;
      const amplitude = (HAUTEUR - REGLE) / 2 - 6;
      const l = largeur / pics.length;
      ctx.fillStyle = "#6f685c";
      for (let i = 0; i < pics.length; i++) {
        const h = Math.max(1, Math.sqrt(pics[i]) * amplitude);
        ctx.fillRect(i * l, milieu - h, Math.max(0.8, l - 0.4), h * 2);
      }
    }

    // répliques
    const hauteurCouloir = (HAUTEUR - REGLE) / couloirs.nombre;
    for (const r of repliques) {
      if (r.fin_ms <= 0 || r.debut_ms >= dureeMs) continue;
      const c = couloirs.parId.get(r.id) ?? 0;
      const x0 = versX(r.debut_ms);
      const x1 = versX(r.fin_ms);
      const w = Math.max(1, x1 - x0);
      const y0 = REGLE + c * hauteurCouloir;
      const teinte = couleur(r.personnage);
      const choisie = r.id === selection;
      ctx.fillStyle = teinte;
      ctx.globalAlpha = choisie ? 0.34 : 0.17;
      ctx.fillRect(x0, y0, w, hauteurCouloir);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = teinte;
      ctx.lineWidth = choisie ? 2 : 1;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, hauteurCouloir - 1);
      ctx.lineWidth = 1;
      ctx.globalAlpha = choisie ? 1 : 0.7;
      ctx.fillRect(x0, y0, 3, hauteurCouloir);
      ctx.fillRect(x1 - 3, y0, 3, hauteurCouloir);
      ctx.globalAlpha = 1;
      if (w > 40) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 + 5, y0, w - 10, hauteurCouloir);
        ctx.clip();
        ctx.textBaseline = "top";
        ctx.fillStyle = "#efeae0";
        ctx.font = "600 12px Segoe UI, system-ui, sans-serif";
        const nom = personnages.find((p) => p.id === r.personnage)?.nom ?? "?";
        ctx.fillText(`${r.id} · ${nom}`, x0 + 6, y0 + 4);
        if (r.texte && hauteurCouloir > 34) {
          ctx.font = "11.5px Segoe UI, system-ui, sans-serif";
          ctx.fillStyle = "#cfc8ba";
          ctx.fillText(r.texte, x0 + 6, y0 + 20);
        }
        ctx.restore();
      }
    }

    if (provisoire) {
      const a = versX(Math.min(provisoire.debut, provisoire.fin));
      const b = versX(Math.max(provisoire.debut, provisoire.fin));
      ctx.fillStyle = "rgba(212, 173, 90, 0.3)";
      ctx.fillRect(a, REGLE, Math.max(1, b - a), HAUTEUR - REGLE);
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
    void [pics, largeur, repliques, personnages, selection, position, provisoire, couloirs];
    dessiner();
  });

  // la vue suit la tête de lecture
  $effect(() => {
    if (!enLecture || !defilement) return;
    const x = versX(position);
    if (x < defilement.scrollLeft + 30 || x > defilement.scrollLeft + defilement.clientWidth - 30) {
      defilement.scrollLeft = x - defilement.clientWidth * 0.25;
    }
  });

  onMount(() => {
    const ro = new ResizeObserver(() => {
      largeurVue = defilement.clientWidth;
      if (!ajuste && dureeMs > 0) {
        pxParS = borner(largeurVue / (dureeMs / 1000), PX_S_MIN, PX_S_MAX);
        ajuste = true;
      }
    });
    ro.observe(defilement);
    return () => ro.disconnect();
  });

  // ---- zoom ----
  function zoomer(facteur: number, ecranX?: number) {
    const sx = ecranX ?? defilement.clientWidth / 2;
    const ancreMs = (defilement.scrollLeft + sx) / pxParMs;
    pxParS = borner(pxParS * facteur, PX_S_MIN, PX_S_MAX);
    requestAnimationFrame(() => (defilement.scrollLeft = ancreMs * pxParMs - sx));
  }
  export function zoomAvant() {
    zoomer(1.6);
  }
  export function zoomArriere() {
    zoomer(1 / 1.6);
  }
  export function toutVoir() {
    pxParS = borner(largeurVue / Math.max(0.5, dureeMs / 1000), PX_S_MIN, PX_S_MAX);
    requestAnimationFrame(() => (defilement.scrollLeft = 0));
  }
  /** Fait défiler (et zoome si besoin) pour montrer une réplique. */
  export function montrer(id: number) {
    const r = repliques.find((x) => x.id === id);
    if (!r || !defilement) return;
    if ((r.fin_ms - r.debut_ms) * pxParMs < 90) {
      pxParS = borner(120 / Math.max(0.05, (r.fin_ms - r.debut_ms) / 1000), PX_S_MIN, PX_S_MAX);
    }
    requestAnimationFrame(() => (defilement.scrollLeft = ((r.debut_ms + r.fin_ms) / 2) * pxParMs - defilement.clientWidth / 2));
  }

  // ---- souris ----
  type Mode = "rien" | "deplacer" | "gauche" | "droite" | "creer";
  let glisse = { mode: "rien" as Mode, id: null as number | null, prise: 0, depart: 0, x0: 0, bouge: false };

  const tempsA = (clientX: number) => borner((clientX - canvas.getBoundingClientRect().left) / pxParMs, 0, dureeMs);

  function toucher(clientX: number, clientY: number): { mode: Mode; id: number | null } {
    const y = clientY - canvas.getBoundingClientRect().top;
    if (y < REGLE) return { mode: "rien", id: null };
    const t = tempsA(clientX);
    const tolerance = POIGNEE_PX / pxParMs;
    let bord: { id: number; mode: Mode; distance: number } | null = null;
    for (const r of repliques) {
      const g = Math.abs(t - r.debut_ms);
      const dr = Math.abs(t - r.fin_ms);
      if (g <= tolerance && (!bord || g < bord.distance)) bord = { id: r.id, mode: "gauche", distance: g };
      if (dr <= tolerance && (!bord || dr < bord.distance)) bord = { id: r.id, mode: "droite", distance: dr };
    }
    if (bord) return { mode: bord.mode, id: bord.id };
    let corps: { id: number; w: number } | null = null;
    for (const r of repliques) {
      if (t > r.debut_ms && t < r.fin_ms && (!corps || r.fin_ms - r.debut_ms < corps.w)) corps = { id: r.id, w: r.fin_ms - r.debut_ms };
    }
    return corps ? { mode: "deplacer", id: corps.id } : { mode: "creer", id: null };
  }

  function appui(e: PointerEvent) {
    canvas.setPointerCapture(e.pointerId);
    const cible = toucher(e.clientX, e.clientY);
    const t = tempsA(e.clientX);
    if (cible.mode === "rien") {
      onseek(t);
      glisse.mode = "rien";
      return;
    }
    const r = cible.id !== null ? repliques.find((x) => x.id === cible.id) : undefined;
    glisse = { mode: cible.mode, id: cible.id, prise: r ? t - r.debut_ms : 0, depart: t, x0: e.clientX, bouge: false };
    if (cible.mode === "creer") provisoire = { debut: t, fin: t };
  }

  function deplacement(e: PointerEvent) {
    if (glisse.mode === "rien") {
      const c = toucher(e.clientX, e.clientY);
      canvas.style.cursor = c.mode === "gauche" || c.mode === "droite" ? "ew-resize" : c.mode === "deplacer" ? "grab" : "default";
      const cadre = enveloppe!.getBoundingClientRect();
      survolee = survol && c.id !== null ? { id: c.id, x: e.clientX - cadre.left, y: e.clientY - cadre.top } : null;
      return;
    }
    survolee = null;
    if (Math.abs(e.clientX - glisse.x0) > SEUIL_PX) glisse.bouge = true;
    if (!glisse.bouge) return;
    const t = tempsA(e.clientX);
    if (glisse.mode === "creer") {
      provisoire = { debut: glisse.depart, fin: t };
      return;
    }
    const r = repliques.find((x) => x.id === glisse.id);
    if (!r) return;
    if (glisse.mode === "gauche") onchange(r.id, Math.round(borner(t, 0, r.fin_ms - MIN_MS)), r.fin_ms);
    else if (glisse.mode === "droite") onchange(r.id, r.debut_ms, Math.round(borner(t, r.debut_ms + MIN_MS, dureeMs)));
    else {
      const largeurR = r.fin_ms - r.debut_ms;
      const debut = Math.round(borner(t - glisse.prise, 0, dureeMs - largeurR));
      onchange(r.id, debut, debut + largeurR);
    }
  }

  function relache(e: PointerEvent) {
    const g = glisse;
    glisse = { ...glisse, mode: "rien", id: null };
    if (g.mode === "creer") {
      const prov = provisoire;
      provisoire = null;
      if (g.bouge && prov) {
        const a = Math.min(prov.debut, prov.fin);
        const b = Math.max(prov.debut, prov.fin);
        if (b - a >= MIN_MS) oncreate(Math.round(a), Math.round(b));
      } else {
        onselect(null);
        onseek(tempsA(e.clientX));
      }
    } else if (g.id !== null) {
      onselect(g.id);
      if (g.bouge) onfin();
    }
  }

  function molette(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomer(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - defilement.getBoundingClientRect().left);
  }
</script>

<div class="enveloppe" bind:this={enveloppe}>
  <div class="defilement" bind:this={defilement} onwheel={molette}>
    <canvas
      bind:this={canvas}
      style:height="{HAUTEUR}px"
      onpointerdown={appui}
      onpointermove={deplacement}
      onpointerup={relache}
      onpointerleave={() => (survolee = null)}
    ></canvas>
  </div>
  {#if survolee && repliqueSurvolee}
    {@const r = repliqueSurvolee}
    <div
      class="bulle"
      style:left="{Math.min(survolee.x + 14, (enveloppe?.clientWidth ?? 800) - 330)}px"
      style:top="{survolee.y + 16}px"
    >
      <div class="entete">
        <span class="puce" style:--c={couleur(r.personnage)}></span>
        <strong>{personnages.find((x) => x.id === r.personnage)?.nom ?? "Sans personnage"}</strong>
        <span class="discret">#{r.id}</span>
      </div>
      <div class="texte">{r.texte || "(pas encore de texte)"}</div>
      <div class="discret temps">
        {(r.debut_ms / 1000).toFixed(2)} → {(r.fin_ms / 1000).toFixed(2)} s · {((r.fin_ms - r.debut_ms) / 1000).toFixed(2)} s
      </div>
    </div>
  {/if}
</div>

<style>
  .enveloppe {
    position: relative;
  }
  .bulle {
    position: absolute;
    z-index: 5;
    pointer-events: none;
    width: 320px;
    background: var(--panneau-2);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--rayon-petit);
    box-shadow: var(--ombre);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }
  .bulle .entete {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .bulle .puce {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--c);
  }
  .bulle .texte {
    font-size: 14px;
  }
  .bulle .temps {
    font-size: 11.5px;
    font-family: var(--police-mono);
  }
  .defilement {
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    border: 1px solid var(--bordure);
    border-radius: var(--rayon-petit);
    background: #0e0d0c;
  }
  canvas {
    display: block;
    touch-action: none;
  }
</style>
