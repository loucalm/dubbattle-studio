// Une couleur par personnage, dans l'ordre du projet (plus distinctes qu'un hachage du nom).

const PALETTE = ["#e0a23a", "#5fa8d3", "#d9665b", "#7cbf6b", "#b58bd6", "#e37fb1", "#4fc1b0", "#c9b458", "#8f9bd9", "#d98b4f"];

export const COULEUR_SANS_PERSONNAGE = "#8a877f";

export function couleurPersonnage(rang: number): string {
  return rang < 0 ? COULEUR_SANS_PERSONNAGE : PALETTE[rang % PALETTE.length];
}
