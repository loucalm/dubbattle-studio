"""Transcription de la voice avec faster-whisper, horodatée mot par mot (appelé par server/python.ts).

Usage :
    python transcrire.py --entree voice.wav --sortie transcription.json --modeles DOSSIER [--langue fr] [--modele large-v3-turbo]

Écrit un JSON : {"modele", "langue", "segments": [{"debut_ms", "fin_ms", "texte", "mots": [...]}]}.
Sortie standard : lignes JSON d'avancement ({"etape"} ou {"progression": 0..1}), puis {"ok": true}.
"""

import argparse
import json
import os
import sys


def signaler(**donnees):
    print(json.dumps(donnees), flush=True)


def charger_modele(nom, dossier):
    from faster_whisper import WhisperModel

    try:
        # torch fournit les DLL CUDA (cuBLAS, cuDNN) dont CTranslate2 a besoin sous Windows
        import torch

        if torch.cuda.is_available():
            return WhisperModel(nom, device="cuda", compute_type="float16", download_root=dossier), "GPU"
    except Exception as erreur:
        signaler(etape=f"GPU indisponible ({erreur}), passage sur le processeur")
    return WhisperModel(nom, device="cpu", compute_type="int8", download_root=dossier), "processeur"


def main():
    parametres = argparse.ArgumentParser()
    parametres.add_argument("--entree", required=True)
    parametres.add_argument("--sortie", required=True)
    parametres.add_argument("--modeles", required=True)
    parametres.add_argument("--langue", default=None)
    parametres.add_argument("--modele", default="large-v3-turbo")
    a = parametres.parse_args()

    signaler(etape="Chargement du modèle (téléchargé au premier usage)")
    modele, materiel = charger_modele(a.modele, os.path.join(a.modeles, "whisper"))
    signaler(etape=f"Transcription ({materiel})")

    segments, info = modele.transcribe(
        a.entree,
        language=a.langue or None,
        word_timestamps=True,
        beam_size=5,
        condition_on_previous_text=False,
        vad_filter=False,
    )
    resultat = []
    for s in segments:
        mots = [
            {"debut_ms": round(m.start * 1000), "fin_ms": round(m.end * 1000), "mot": m.word}
            for m in (s.words or [])
        ]
        resultat.append(
            {"debut_ms": round(s.start * 1000), "fin_ms": round(s.end * 1000), "texte": s.text.strip(), "mots": mots}
        )
        if info.duration:
            signaler(progression=min(1.0, s.end / info.duration))

    with open(a.sortie, "w", encoding="utf-8") as f:
        json.dump({"modele": a.modele, "langue": info.language, "segments": resultat}, f, ensure_ascii=False, indent=2)
    signaler(ok=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as erreur:
        print(f"ERREUR : {erreur}", file=sys.stderr, flush=True)
        sys.exit(1)
