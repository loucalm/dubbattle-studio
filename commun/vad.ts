// Détection de parole par énergie (VAD simplifiée, reprise de la V2 : web/src/lib/vad.ts).
// Sert à proposer des répliques candidates, à ajuster ensuite dans l'éditeur.
//
// Principe : trames de 20 ms, énergie RMS de chaque trame, seuil relatif au bruit de fond
// (20e centile), les silences courts (< 300 ms) sont comblés, les segments trop brefs
// (< 150 ms) éliminés, puis une petite marge est ajoutée autour de chaque segment.

export interface OptionsVad {
  /** silence toléré à l'intérieur d'une même réplique */
  silenceMaxMs?: number;
  /** segments plus courts ignorés */
  segmentMinMs?: number;
  /** marge ajoutée avant et après (souffle, fin de phrase) */
  margeMs?: number;
}

export interface SegmentParole {
  debut_ms: number;
  fin_ms: number;
}

export function detecterParole(
  canaux: Float32Array[],
  frequence: number,
  { silenceMaxMs = 300, segmentMinMs = 150, margeMs = 150 }: OptionsVad = {},
): SegmentParole[] {
  const trameMs = 20;
  const tailleTrame = Math.max(1, Math.round((frequence * trameMs) / 1000));
  const longueur = canaux[0]?.length ?? 0;
  if (longueur === 0) return [];
  const nbTrames = Math.ceil(longueur / tailleTrame);
  const dureeMs = (longueur / frequence) * 1000;

  const energie = new Float32Array(nbTrames);
  for (let f = 0; f < nbTrames; f++) {
    const debut = f * tailleTrame;
    const fin = Math.min(longueur, debut + tailleTrame);
    let somme = 0;
    for (let i = debut; i < fin; i++) {
      let v = 0;
      for (const c of canaux) v += c[i];
      v /= canaux.length;
      somme += v * v;
    }
    energie[f] = Math.sqrt(somme / Math.max(1, fin - debut));
  }

  const triee = Array.from(energie).sort((a, b) => a - b);
  const bruit = triee[Math.floor(triee.length * 0.2)] ?? 0;
  const seuil = Math.max(bruit * 3, 0.008);

  // passe 1 : trames voisées consécutives
  const suites: Array<[number, number]> = [];
  let ouverture = -1;
  for (let f = 0; f < nbTrames; f++) {
    const voisee = energie[f] > seuil;
    if (voisee && ouverture === -1) ouverture = f;
    if (!voisee && ouverture !== -1) {
      suites.push([ouverture, f]);
      ouverture = -1;
    }
  }
  if (ouverture !== -1) suites.push([ouverture, nbTrames]);

  // passe 2 : fusion des silences courts
  const trouMax = Math.round(silenceMaxMs / trameMs);
  const fusionnees: Array<[number, number]> = [];
  for (const s of suites) {
    const derniere = fusionnees[fusionnees.length - 1];
    if (derniere && s[0] - derniere[1] <= trouMax) derniere[1] = s[1];
    else fusionnees.push([s[0], s[1]]);
  }

  // passe 3 : segments trop courts retirés, marges ajoutées
  const segmentMin = Math.round(segmentMinMs / trameMs);
  return fusionnees
    .filter(([d, f]) => f - d >= segmentMin)
    .map(([d, f]) => ({
      debut_ms: Math.max(0, Math.round(d * trameMs - margeMs)),
      fin_ms: Math.min(Math.round(dureeMs), Math.round(f * trameMs + margeMs)),
    }));
}
