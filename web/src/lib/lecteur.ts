// Lecteur synchronisé : une vidéo muette + plusieurs pistes audio (Web Audio) lues ensemble.
// Sert à comparer les séparations, à caler les répliques et au « mode jeu » du contrôle.
// Les temps sont en millisecondes depuis le début de l'extrait.

let contexte: AudioContext | null = null;
export function contexteAudio(): AudioContext {
  contexte ??= new AudioContext({ latencyHint: "interactive" });
  return contexte;
}

const tampons = new Map<string, Promise<AudioBuffer>>();

/** Télécharge et décode une piste audio (gardée en cache par adresse). */
export function chargerTampon(url: string): Promise<AudioBuffer> {
  let p = tampons.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Piste audio introuvable (${r.status})`);
        return r.arrayBuffer();
      })
      .then((octets) => contexteAudio().decodeAudioData(octets));
    p.catch(() => tampons.delete(url));
    tampons.set(url, p);
  }
  return p;
}

interface Piste {
  tampon: AudioBuffer;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

export class Lecteur {
  private ctx = contexteAudio();
  private pistes = new Map<string, Piste>();
  private video: HTMLVideoElement | null = null;
  private decalageVideo = 0;
  private debutCtx = 0;
  private debutMs = 0;
  private finMs: number | null = null;
  private arretMs = 0;
  private animation = 0;
  /** filet de sécurité : requestAnimationFrame est suspendu quand la fenêtre est cachée */
  private veille: ReturnType<typeof setInterval> | null = null;
  enLecture = false;
  dureeMs = 0;
  /** appelé à la fin d'une lecture bornée (ou de l'extrait) */
  surFin: (() => void) | null = null;
  /** appelé à chaque image pendant la lecture, et à chaque déplacement */
  surPosition: ((ms: number) => void) | null = null;

  attacherVideo(video: HTMLVideoElement | null, decalageMs: number): void {
    this.video = video;
    this.decalageVideo = decalageMs;
    if (video) {
      video.muted = true;
      video.currentTime = (decalageMs + this.position()) / 1000;
    }
  }

  ajouterPiste(nom: string, tampon: AudioBuffer, volume = 1): void {
    this.retirerPiste(nom);
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    gain.connect(this.ctx.destination);
    this.pistes.set(nom, { tampon, gain, source: null });
    this.dureeMs = Math.max(this.dureeMs, tampon.duration * 1000);
    if (this.enLecture) this.jouer(this.position(), this.finMs ?? undefined);
  }

  retirerPiste(nom: string): void {
    const p = this.pistes.get(nom);
    if (!p) return;
    p.source?.stop();
    p.gain.disconnect();
    this.pistes.delete(nom);
  }

  aPiste(nom: string): boolean {
    return this.pistes.has(nom);
  }

  noms(): string[] {
    return [...this.pistes.keys()];
  }

  volume(nom: string, valeur: number): void {
    const p = this.pistes.get(nom);
    if (p) p.gain.gain.setTargetAtTime(valeur, this.ctx.currentTime, 0.008);
  }

  /**
   * Joue un court extrait sans changer l'état du lecteur (son « image par image ») : les pistes
   * gardent leur volume actuel, avec un petit fondu pour éviter les clics.
   */
  apercu(depuisMs: number, dureeMs: number): void {
    if (this.enLecture) return;
    void this.ctx.resume();
    const t0 = this.ctx.currentTime + 0.005;
    const d = dureeMs / 1000;
    const fondu = Math.min(0.008, d / 4);
    for (const p of this.pistes.values()) {
      if (p.gain.gain.value < 0.001 || depuisMs / 1000 >= p.tampon.duration) continue;
      const enveloppe = this.ctx.createGain();
      enveloppe.gain.setValueAtTime(0, t0);
      enveloppe.gain.linearRampToValueAtTime(1, t0 + fondu);
      enveloppe.gain.setValueAtTime(1, t0 + d - fondu);
      enveloppe.gain.linearRampToValueAtTime(0, t0 + d);
      enveloppe.connect(p.gain);
      const source = this.ctx.createBufferSource();
      source.buffer = p.tampon;
      source.connect(enveloppe);
      source.onended = () => enveloppe.disconnect();
      source.start(t0, Math.max(0, depuisMs) / 1000, d);
    }
  }

  /** N'entendre que cette piste. */
  solo(nom: string): void {
    for (const [n, p] of this.pistes) p.gain.gain.setTargetAtTime(n === nom ? 1 : 0, this.ctx.currentTime, 0.008);
  }

  position(): number {
    if (!this.enLecture) return this.arretMs;
    const pos = this.debutMs + Math.max(0, this.ctx.currentTime - this.debutCtx) * 1000;
    return Math.min(pos, this.finMs ?? this.dureeMs);
  }

  jouer(depuisMs = this.position(), jusquaMs?: number): void {
    this.arreterSources();
    void this.ctx.resume();
    const depart = this.ctx.currentTime + 0.06;
    const debut = Math.max(0, Math.min(depuisMs, this.dureeMs));
    for (const p of this.pistes.values()) {
      const source = this.ctx.createBufferSource();
      source.buffer = p.tampon;
      source.connect(p.gain);
      if (debut / 1000 < p.tampon.duration) source.start(depart, debut / 1000);
      p.source = source;
    }
    this.debutCtx = depart;
    this.debutMs = debut;
    this.finMs = jusquaMs ?? null;
    this.enLecture = true;
    if (this.video) {
      this.video.currentTime = (this.decalageVideo + debut) / 1000;
      void this.video.play().catch(() => undefined);
    }
    cancelAnimationFrame(this.animation);
    if (this.veille) clearInterval(this.veille);
    this.veille = setInterval(() => this.verifierFin(), 100);
    this.boucle();
  }

  pause(): void {
    if (!this.enLecture) return;
    this.arretMs = this.position();
    this.enLecture = false;
    this.arreterSources();
    this.video?.pause();
    cancelAnimationFrame(this.animation);
    if (this.veille) clearInterval(this.veille);
    this.veille = null;
    this.surPosition?.(this.arretMs);
  }

  basculer(): void {
    if (this.enLecture) this.pause();
    else this.jouer(this.arretMs >= this.dureeMs - 5 ? 0 : this.arretMs);
  }

  aller(ms: number): void {
    const cible = Math.max(0, Math.min(ms, this.dureeMs || ms));
    if (this.enLecture) {
      this.jouer(cible, this.finMs !== null && cible < this.finMs ? this.finMs : undefined);
    } else {
      this.arretMs = cible;
      if (this.video) this.video.currentTime = (this.decalageVideo + cible) / 1000;
      this.surPosition?.(cible);
    }
  }

  private arreterSources(): void {
    for (const p of this.pistes.values()) {
      try {
        p.source?.stop();
      } catch {
        // déjà arrêtée
      }
      p.source = null;
    }
  }

  /** Arrête la lecture une fois la fin atteinte. Renvoie vrai si c'est le cas. */
  private verifierFin(): boolean {
    if (!this.enLecture) return true;
    const fin = this.finMs ?? this.dureeMs;
    if (fin > 0 && this.position() >= fin) {
      this.pause();
      this.arretMs = fin;
      this.surPosition?.(fin);
      this.surFin?.();
      return true;
    }
    return false;
  }

  private boucle = (): void => {
    if (this.verifierFin()) return;
    const pos = this.position();
    // la vidéo suit l'horloge audio : on la recale si elle dérive
    if (this.video && !this.video.seeking) {
      const attendu = (this.decalageVideo + pos) / 1000;
      if (Math.abs(this.video.currentTime - attendu) > 0.08) this.video.currentTime = attendu;
    }
    this.surPosition?.(pos);
    this.animation = requestAnimationFrame(this.boucle);
  };

  detruire(): void {
    this.pause();
    for (const nom of [...this.pistes.keys()]) this.retirerPiste(nom);
    this.surFin = null;
    this.surPosition = null;
  }
}
