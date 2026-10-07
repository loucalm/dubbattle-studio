# dubbattle-studio — l'outil de fabrication des extraits

Application web **locale** (jamais déployée) qui fabrique les extraits de Dub-Battle : import d'une vidéo, découpe, séparation voix / fond, répliques, encodage, publication dans `../extraits/`.

**Référence : section 7 de `../Dub-Battle V3 — Fiche technique.md`** (workflow en 8 étapes, formats, réglages ffmpeg, modification d'un extrait, versions). La lire avant de toucher au traitement ou aux formats.

## Stack

- Serveur Node.js 22 (TypeScript, lancé par `tsx`, sans framework : `node:http` et un petit routeur) qui pilote les outils natifs, et interface Svelte 5 + Vite dans le navigateur, sur `localhost` uniquement.
- Outils natifs appelés par le serveur : **ffmpeg / ffprobe**, **audio-separator** (qui fait tourner Demucs et les modèles d'UVR), **faster-whisper**, **yt-dlp** (vidéos YouTube, avec le Node du Studio comme moteur JavaScript), **git**.
- Dépendances Python dans `studio/.venv` (Python 3.12, créé avec `uv`), listées dans `python/requirements.txt`. torch et onnxruntime sont installés à part par `scripts/installer-python.mjs` (CUDA 12.8 si une carte NVIDIA est présente).
- Interface en français uniquement : pas de système de traduction ici.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm install` | Dépendances Node |
| `npm run python:installer` | Environnement Python (`.venv`) : torch, audio-separator, faster-whisper, yt-dlp. Ajouter `-- --cpu` pour forcer la version sans GPU |
| `npm run ytdlp:maj` | Met seulement yt-dlp à jour (à faire quand YouTube casse le téléchargement) |
| `npm run studio` | Compile l'interface et lance le Studio sur http://localhost:5180 |
| `npm run dev` | Développement : serveur relancé à chaque modification + Vite sur http://localhost:5181 |
| `npm run check` | Types : serveur (`tsc`) et interface (`svelte-check`) |
| `npm test` | Tests Vitest (logique pure de `commun/`, contrat avec `../extraits/schema`) |

Configuration facultative dans `.env` (voir `.env.example`) : dossiers, port, modèle Whisper, chemins des outils. Les modèles d'IA sont téléchargés au premier usage dans `models/` (ignoré par git).

## Organisation

```
commun/        logique pure partagée serveur / interface, testée : types, temps, répliques,
               recettes d'encodage (ce qui est à refaire), construction des JSON publiés, VAD
server/        serveur local : routes (API), travaux (workflow), ffmpeg, python, retouche (export et
               import de pistes), publication (git), contrôle, dialogues (fenêtres « Ouvrir » de
               Windows), fichiers (recherche d'une vidéo glissée), youtube (téléchargement avec
               yt-dlp), tâches de fond (suivies en direct par SSE), projets (espace de travail)
python/        scripts appelés par le serveur : separer.py, transcrire.py, outils.py, webp.py (vignette
               quand ffmpeg n'a pas libwebp, comme celui de Homebrew)
web/src/       interface : ecrans/ (bibliothèque, projet), etapes/ (les 8 étapes), composants/, lib/
tests/         tests Vitest
```

Un projet vit dans `../studio-workspace/<id>/` : `projet.json` (l'état), `apercu.mp4` (sources illisibles par le navigateur), `pics.bin` (forme d'onde de la source), `mix.wav` (audio de la plage), `separations/<id>/{voice,bed}.wav`, `imports/<id>.wav` (pistes retouchées, mises aux normes), `export/` (copies téléchargées), `transcription.json`, `sortie/` (médias encodés). `../studio-workspace/_sources/` garde les copies de vidéos glissées introuvables sur le disque et les vidéos téléchargées depuis YouTube (nommées `<titre> [<id YouTube>].mp4`, avec la plage en plus pour un passage seul ; fichiers partiels dans `_sources/.partiels/`, effacés à la fin).

L'identifiant d'un extrait est son titre mis en forme ; tant que l'extrait n'est pas publié, changer le titre renomme le projet (et son dossier).

## Règles

- **Le contrat, ce sont les schémas** de `../extraits/schema/`. Tout ce que le Studio écrit (`info.json`, `repliques.json`, `fabrication.json`, `catalogue.json`) doit les valider avant publication (`tests/contrat.test.ts` le vérifie). Ne pas changer un format sans mettre à jour le schéma, la fiche et le jeu.
- **Un seul encodage depuis la source** : jamais de réencodage d'un fichier déjà compressé, sauf en dernier recours (source introuvable), en le signalant.
- **Formats de sortie** (fiche 7.8) : vidéo H.264 720p max CRF 26 sans audio, image clé chaque seconde et au début de chaque réplique, `faststart` ; voice AAC mono 48 kbps ; bed AAC stéréo 96 kbps ; même gain sur voice et bed ; vignette WebP 640 px ; 25 Mo max par fichier (limite Cloudflare Pages).
- **Temps** : ceux de ffmpeg (0 = `start_time` du fichier, ce que vise `-ss`). La découpe est calée juste avant une image de la source (`caleSurImage`) et la vidéo est encodée avec un nombre d'images exact (`-frames:v`) : ne pas revenir à `-t` pour la vidéo, ffmpeg y ajouterait parfois une image.
- **Seul ce qui a changé est refait** (fiche 7.6) : chaque média encodé garde sa « recette » (`commun/encodage.ts`). Quand une commande ffmpeg change, augmenter `VERSIONS_RECETTE` pour que les anciens fichiers soient signalés à refaire. `version_medias` n'augmente que si un fichier média publié change.
- **Pas de normalisation par piste** : audio-separator normalise chaque piste séparément, ce qui casse l'équilibre voix / fond. `python/separer.py` contourne ce comportement ; ne pas le retirer.
- **Les id de répliques ne sont jamais réutilisés** (`prochain_id_replique` ne diminue jamais).
- **Fichiers de travail** dans `../studio-workspace/<id>/`, jamais dans un dépôt git. Les vidéos sources ne sont jamais copiées dans un dépôt : on garde seulement leur empreinte (sha256) dans `fabrication.json`.
- **Publication** : écrire dans `../extraits/`, régénérer `catalogue.json`, puis commit et push dans ce dépôt-là, avec un message clair (« Ajout de <id> », « <id> : répliques corrigées »). Toujours montrer ce qui va être publié avant de pousser. Pour tester sans toucher au vrai dépôt : `DOSSIER_EXTRAITS` vers un clone jetable dont le `origin` est un dépôt nu local.
- Préparer le passage des médias sur Cloudflare R2 (fiche 7.9) : l'envoi des médias passe par une seule fonction, `envoyerMedias()` dans `server/publication.ts`, qu'on redirigera vers R2.
- **Fichiers servis** : toujours par `envoyerFichier()` (`server/http.ts`), qui referme le fichier même si le navigateur abandonne la requête (ce que Chrome fait sans arrêt avec la vidéo). Un fichier resté ouvert bloque sous Windows son remplacement, le renommage ou la suppression du projet.
- Sécurité : le serveur n'écoute que `127.0.0.1`, refuse les requêtes dont l'en-tête `Host` n'est pas local, et exige du JSON pour les corps de requête (pas de requête « simple » depuis une page tierce). Les envois binaires (copie d'une vidéo, import d'une piste) exigent l'en-tête `x-studio: 1`, pour la même raison.
- **yt-dlp n'est pas figé** dans `requirements.txt` : YouTube change souvent et seule la dernière version suit. Ne jamais lui passer une adresse sans `--` devant (une adresse commençant par `-` serait lue comme une option) ; `verifierAdresse()` n'accepte que http(s).
- Secrets (jeton R2 plus tard) : uniquement dans `.env`, jamais commités.
- L'éditeur de répliques (`web/src/composants/EditeurRepliques.svelte`) et la VAD (`commun/vad.ts`) reprennent l'Atelier de la V2 (https://github.com/loucalm/Dubbattle-V2 : `RegionEditor.tsx`, `lib/vad.ts`).
