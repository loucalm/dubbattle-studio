import { describe, expect, it } from "vitest";
import { trouverDecalage } from "../commun/correlation.ts";

/** Bruit reproductible : un signal large bande, comme de la parole ou de la musique. */
function bruit(longueur: number, graine = 1): Float32Array {
  // mulberry32 : deux graines donnent deux suites sans rapport
  let a = graine >>> 0;
  const s = new Float32Array(longueur);
  for (let i = 0; i < longueur; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    s[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  }
  return s;
}

describe("décalage d'une piste importée", () => {
  const frequence = 8000;
  const ref = bruit(frequence * 6);

  it("trouve un blanc ajouté au début (piste en retard)", () => {
    const decalage = Math.round(0.137 * frequence);
    const piste = new Float32Array(ref.length + decalage);
    piste.set(ref, decalage);
    const r = trouverDecalage(ref, piste, frequence);
    expect(r.decalage_ms).toBe(137);
    expect(r.confiance).toBeGreaterThan(0.9);
  });

  it("trouve une piste en avance, mélangée à autre chose", () => {
    const avance = Math.round(0.05 * frequence);
    const autre = bruit(ref.length, 7);
    const piste = new Float32Array(ref.length);
    for (let i = 0; i < piste.length - avance; i++) piste[i] = 0.6 * ref[i + avance] + 0.4 * autre[i];
    const r = trouverDecalage(ref, piste, frequence);
    expect(r.decalage_ms).toBe(-50);
    expect(r.confiance).toBeGreaterThan(0.5);
  });

  it("ne trouve rien de fiable entre deux signaux sans rapport", () => {
    const r = trouverDecalage(ref, bruit(ref.length, 99), frequence);
    expect(r.confiance).toBeLessThan(0.1);
  });
});
