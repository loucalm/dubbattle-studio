# dubbattle-studio — l'outil de fabrication des extraits

Application web **locale** (jamais déployée) qui fabrique les extraits de Dub-Battle : import d'une vidéo, découpe, séparation voix / fond, répliques, encodage, publication dans `../extraits/`.

**Référence : section 7 de `../Dub-Battle V3 — Fiche technique.md`** (workflow en 8 étapes, formats, réglages ffmpeg, modification d'un extrait, versions). La lire avant de toucher au traitement ou aux formats.

## Stack

- Serveur Node.js (TypeScript) qui pilote les outils natifs, et interface Svelte 5 + Vite dans le navigateur, sur `localhost`.
- Outils natifs appelés par le serveur : **ffmpeg / ffprobe**, **Demucs**, **audio-separator** (modèles UVR), **faster-whisper**, **git**.
- Dépendances Python dans un environnement virtuel propre au Studio (`studio/.venv`), listées dans un fichier de dépendances commité.
- Interface en français uniquement : pas de système de traduction ici.

Le projet n'est pas encore initialisé : compléter la section « Commandes » ci-dessous lors de la mise en place.

## Commandes

À compléter (`npm run studio`, installation des dépendances Python, tests).

## Règles

- **Le contrat, ce sont les schémas** de `../extraits/schema/`. Tout ce que le Studio écrit (`info.json`, `repliques.json`, `fabrication.json`, `catalogue.json`) doit les valider avant publication. Ne pas changer un format sans mettre à jour le schéma, la fiche et le jeu.
- **Un seul encodage depuis la source** : jamais de réencodage d'un fichier déjà compressé, sauf en dernier recours (source introuvable), en le signalant.
- **Formats de sortie** (fiche 7.8) : vidéo H.264 720p max CRF 26 sans audio, image clé chaque seconde et au début de chaque réplique, `faststart` ; voice AAC mono 48 kbps ; bed AAC stéréo 96 kbps ; même gain sur voice et bed ; vignette WebP 640 px ; 25 Mo max par fichier (limite Cloudflare Pages).
- **Seul ce qui a changé est refait** (fiche 7.6) : une modification de texte ou de timecode ne réécrit que les JSON. `version_medias` n'augmente que si un fichier média change.
- **Les id de répliques ne sont jamais réutilisés.**
- **Fichiers de travail** dans `../studio-workspace/<id>/`, jamais dans un dépôt git. Les vidéos sources ne sont jamais copiées dans un dépôt : on garde seulement leur empreinte (sha256) dans `fabrication.json`.
- **Publication** : écrire dans `../extraits/`, régénérer `catalogue.json`, puis commit et push dans ce dépôt-là, avec un message clair (« Ajout de <id> », « <id> : répliques corrigées »). Toujours montrer ce qui va être publié avant de pousser.
- Préparer le passage des médias sur Cloudflare R2 (fiche 7.9) : l'envoi des médias doit passer par une seule fonction, qu'on pourra rediriger vers R2.
- Secrets (jeton R2 plus tard) : uniquement dans `.env`, jamais commités.
- Reprendre l'Atelier de la V2 (https://github.com/loucalm/Dubbattle-V2 : `Atelier.tsx`, `RegionEditor.tsx`, `lib/vad.ts`) pour l'éditeur de répliques et la détection de parole.
