// Événements envoyés en direct à l'interface (Server-Sent Events sur /api/evenements).

import type { ServerResponse } from "node:http";

const clients = new Set<ServerResponse>();

export type Evenement =
  | { type: "tache"; donnees: unknown }
  | { type: "projet"; donnees: { id: string } }
  | { type: "projets"; donnees: null };

export function abonner(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write("retry: 2000\n\n");
  clients.add(res);
  const battement = setInterval(() => res.write(": ok\n\n"), 20_000);
  res.on("close", () => {
    clearInterval(battement);
    clients.delete(res);
  });
}

export function diffuser(evenement: Evenement): void {
  const message = `event: ${evenement.type}\ndata: ${JSON.stringify(evenement.donnees)}\n\n`;
  for (const res of clients) res.write(message);
}
