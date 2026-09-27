// Temps : tout est en millisecondes entières (convention des extraits).

/** « 1:02:03.456 », ou « 02:03.456 » sous une heure. */
export function formaterTemps(ms: number, heures = false): string {
  const signe = ms < 0 ? "-" : "";
  const total = Math.round(Math.abs(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  const fin = `${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
  if (h > 0 || heures) return `${signe}${h}:${String(m).padStart(2, "0")}:${fin}`;
  return `${signe}${String(m).padStart(2, "0")}:${fin}`;
}

/** Durée courte et lisible : « 42,0 s », « 1 min 05 s », « 1 h 52 min ». */
export function formaterDuree(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
  const totalS = Math.round(s);
  if (totalS < 3600) return `${Math.floor(totalS / 60)} min ${String(totalS % 60).padStart(2, "0")} s`;
  return `${Math.floor(totalS / 3600)} h ${String(Math.floor((totalS % 3600) / 60)).padStart(2, "0")} min`;
}

/**
 * Lit un temps saisi à la main : « 1:02:03.456 », « 2:03.4 », « 123.5 », « 123,5 ».
 * Renvoie null si le texte n'est pas un temps valide.
 */
export function lireTemps(texte: string): number | null {
  const t = texte.trim().replace(",", ".");
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null;
  const parties = t.split(":");
  let secondes = 0;
  for (const p of parties) secondes = secondes * 60 + Number(p);
  const [, ...reste] = parties;
  if (reste.some((p) => Number(p.split(".")[0]) >= 60)) return null;
  return Math.round(secondes * 1000);
}

/**
 * Cale un temps sur l'image la plus proche, pour une découpe « à l'image près ».
 * `decalage` est l'instant de la première image. Le résultat est arrondi à la milliseconde
 * inférieure, moins 1 ms : ffmpeg (« -ss ») garde ainsi toujours l'image visée comme première
 * image, même quand le conteneur arrondit ses horodatages à la milliseconde (MKV).
 */
export function caleSurImage(ms: number, ips: number, decalage = 0): number {
  if (!(ips > 0)) return Math.round(ms);
  const image = Math.round(((ms - decalage) * ips) / 1000);
  return Math.max(0, Math.floor((image * 1000) / ips + decalage) - 1);
}

/** Durée d'une image, en millisecondes. */
export function dureeImage(ips: number): number {
  return ips > 0 ? 1000 / ips : 40;
}
