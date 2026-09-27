// Détection du décalage d'une piste importée (fiche 7.5) : un logiciel externe ajoute parfois un
// blanc au début. On compare la piste au mélange original par corrélation croisée, d'abord à
// 1 kHz sur ±1 s, puis finement à la fréquence d'origine autour du meilleur décalage.

export interface ResultatDecalage {
  /** > 0 : la piste importée est en retard (il faut couper son début) ; < 0 : en avance */
  decalage_ms: number;
  /** corrélation normalisée au meilleur décalage, entre 0 et 1 */
  confiance: number;
}

function sousEchantillonner(signal: Float32Array, facteur: number): Float32Array {
  const n = Math.floor(signal.length / facteur);
  const sortie = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let somme = 0;
    for (let j = 0; j < facteur; j++) somme += signal[i * facteur + j];
    sortie[i] = somme / facteur;
  }
  return sortie;
}

/** Corrélation normalisée de ref[i] avec piste[i + decalage], sur la partie commune. */
function correlation(ref: Float32Array, piste: Float32Array, decalage: number): number {
  const debut = Math.max(0, -decalage);
  const fin = Math.min(ref.length, piste.length - decalage);
  let produit = 0;
  let energieRef = 0;
  let energiePiste = 0;
  for (let i = debut; i < fin; i++) {
    const a = ref[i];
    const b = piste[i + decalage];
    produit += a * b;
    energieRef += a * a;
    energiePiste += b * b;
  }
  const norme = Math.sqrt(energieRef * energiePiste);
  return norme > 0 ? produit / norme : 0;
}

export function trouverDecalage(ref: Float32Array, piste: Float32Array, frequence: number, maxMs = 1000): ResultatDecalage {
  const facteur = Math.max(1, Math.round(frequence / 1000));
  const refGrossier = sousEchantillonner(ref, facteur);
  const pisteGrossiere = sousEchantillonner(piste, facteur);
  const frequenceGrossiere = frequence / facteur;
  const maxGrossier = Math.round((maxMs / 1000) * frequenceGrossiere);

  let meilleur = 0;
  let meilleureValeur = -Infinity;
  for (let d = -maxGrossier; d <= maxGrossier; d++) {
    const c = correlation(refGrossier, pisteGrossiere, d);
    if (c > meilleureValeur) {
      meilleureValeur = c;
      meilleur = d;
    }
  }

  // affinage à pleine résolution, à ± deux pas grossiers
  let fin = meilleur * facteur;
  let valeurFine = -Infinity;
  for (let d = meilleur * facteur - 2 * facteur; d <= meilleur * facteur + 2 * facteur; d++) {
    const c = correlation(ref, piste, d);
    if (c > valeurFine) {
      valeurFine = c;
      fin = d;
    }
  }
  return { decalage_ms: Math.round((fin / frequence) * 1000), confiance: Math.max(0, valeurFine) };
}
