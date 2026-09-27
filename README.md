# Studio Dub-Battle

Outil local qui fabrique les extraits de Dub-Battle, d'une vidéo source jusqu'à la publication dans le dépôt `dubbattle-extraits` (servi par Cloudflare Pages). Tout est décrit dans la section 7 de la fiche technique.

## Installation

Prérequis : Node.js 22, ffmpeg dans le PATH, git, [uv](https://docs.astral.sh/uv/) (`winget install astral-sh.uv`), et le clone de `dubbattle-extraits` à côté du Studio (`../extraits`).

```bash
npm install
npm run python:installer
```

Le second script crée `studio/.venv` (Python 3.12) et installe la séparation (audio-separator : Demucs et modèles UVR) et la transcription (faster-whisper), en version GPU si une carte NVIDIA est présente. Compter quelques Go.

## Lancement

```bash
npm run studio
```

Puis ouvrir http://localhost:5180.

## Les 8 étapes

1. **Import** : « Parcourir… » (fenêtre « Ouvrir » de Windows), glisser une vidéo dans la fenêtre, ou coller son chemin, puis lui donner un titre. La vidéo reste à sa place ; le Studio garde son empreinte. Un fichier glissé est retrouvé dans Téléchargements, Vidéos, Bureau, Documents et les dossiers déclarés dans **Réglages** ; sinon, le Studio propose d'en faire une copie.
2. **Découpe** : entrée et sortie à l'image près (`I`, `O`, flèches, `L` pour lire la sélection), ou « Tout sélectionner ».
3. **Voix et fond** : lancer un ou plusieurs modèles, comparer à l'oreille (touches `1` à `9`), garder la meilleure voice et le meilleur bed. Chaque piste se télécharge (⬇) pour être retouchée dans un autre logiciel, puis se réimporte (« Importer une voice / un bed ») : le Studio la recale sur l'original.
4. **Répliques** : dessiner les zones sur la forme d'onde, ou les proposer avec « Détecter la parole » et « Transcrire (Whisper) ». Personnage avec `1` à `9`, image par image avec `←` `→` (`Maj` : 1 s). « Aperçu au survol » et « Son image par image » s'activent et se désactivent dans la barre.
5. **Infos** : titre (l'identifiant le suit jusqu'à la première publication), catégorie, tags, langue, vignette.
6. **Encodage** : taille estimée avant d'encoder ; un seul encodage depuis la source ; seul ce qui a changé est refait.
7. **Contrôle** : vérifications automatiques et « mode jeu » sur les fichiers encodés.
8. **Publication** : aperçu des fichiers, puis commit et push dans `../extraits`.

Un extrait déjà publié se rouvre depuis la bibliothèque (« Publiés »), même sur un autre PC : répliques et infos sont modifiables tout de suite, le reste dès que la source est retrouvée.
