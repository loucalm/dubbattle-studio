"""Séparation voix / fond pour le Studio Dub-Battle (appelé par server/python.ts).

Usage :
    python separer.py --entree mix.wav --modele htdemucs_ft.yaml --sortie DOSSIER --modeles DOSSIER_MODELES

Écrit DOSSIER/voice.wav et DOSSIER/bed.wav, en WAV flottant, à la fréquence et à la durée exactes
de l'entrée. La voice est la piste « Vocals » du modèle ; le bed est la somme de toutes les autres
(« Instrumental », ou batterie + basse + autres pour Demucs).

Aucune normalisation : audio-separator ramène chaque piste qui dépasse un pic donné (au mieux 1,0)
sous ce pic, ce qui casserait l'équilibre voix / fond. On sépare donc une copie du mix atténuée de
6 dB, puis on remonte les pistes d'autant : aucune n'atteint le seuil. Le gain final est appliqué
plus tard, pareil sur les deux pistes.

Sortie standard : une ligne JSON par étape ({"etape": "..."}), puis {"ok": true}.
"""

import argparse
import json
import logging
import os
import re
import shutil
import sys
import tempfile


ATTENUATION = 0.5


def signaler(**donnees):
    print(json.dumps(donnees), flush=True)


def ajuster(piste, longueur, canaux):
    """Même nombre d'échantillons et de canaux que le mix."""
    import numpy as np

    if piste.shape[1] != canaux:
        piste = np.repeat(piste[:, :1], canaux, axis=1) if piste.shape[1] == 1 else piste[:, :canaux]
    if piste.shape[0] < longueur:
        piste = np.pad(piste, ((0, longueur - piste.shape[0]), (0, 0)))
    return piste[:longueur]


def main():
    parametres = argparse.ArgumentParser()
    parametres.add_argument("--entree", required=True)
    parametres.add_argument("--modele", required=True)
    parametres.add_argument("--sortie", required=True)
    parametres.add_argument("--modeles", required=True)
    a = parametres.parse_args()

    import numpy as np
    import soundfile as sf
    from audio_separator.separator import Separator

    os.makedirs(a.sortie, exist_ok=True)
    os.makedirs(a.modeles, exist_ok=True)
    mix, frequence = sf.read(a.entree, dtype="float32", always_2d=True)
    temporaire = tempfile.mkdtemp(prefix="brut-", dir=a.sortie)
    try:
        attenue = os.path.join(temporaire, "mix.wav")
        sf.write(attenue, mix * ATTENUATION, frequence, subtype="FLOAT")

        signaler(etape="Chargement du modèle (téléchargé au premier usage)")
        separateur = Separator(
            log_level=logging.WARNING,
            model_file_dir=a.modeles,
            output_dir=temporaire,
            output_format="WAV",
            normalization_threshold=1.0,
            amplification_threshold=0.0,
            sample_rate=frequence,
            use_soundfile=True,
        )
        separateur.load_model(model_filename=a.modele)

        signaler(etape="Séparation")
        fichiers = separateur.separate(attenue)

        signaler(etape="Assemblage de la voice et du bed")
        voix = None
        autres = []
        for fichier in fichiers:
            chemin = fichier if os.path.isabs(fichier) else os.path.join(temporaire, fichier)
            nom = re.search(r"\(([^)]+)\)", os.path.basename(chemin))
            piste = nom.group(1).lower() if nom else ""
            donnees, _ = sf.read(chemin, dtype="float32", always_2d=True)
            donnees = ajuster(donnees, mix.shape[0], mix.shape[1]) / ATTENUATION
            if piste == "vocals" and voix is None:
                voix = donnees
            else:
                autres.append(donnees)
        if voix is None:
            raise RuntimeError("Le modèle n'a pas produit de piste « Vocals ».")
        bed = np.sum(autres, axis=0) if autres else mix - voix

        sf.write(os.path.join(a.sortie, "voice.wav"), voix, frequence, subtype="FLOAT")
        sf.write(os.path.join(a.sortie, "bed.wav"), bed, frequence, subtype="FLOAT")
        signaler(ok=True)
    finally:
        shutil.rmtree(temporaire, ignore_errors=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as erreur:  # message lisible pour l'interface
        print(f"ERREUR : {erreur}", file=sys.stderr, flush=True)
        sys.exit(1)
