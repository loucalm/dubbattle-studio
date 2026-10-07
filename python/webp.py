"""Conversion d'une image en WebP, quand ffmpeg n'a pas l'encodeur libwebp (ffmpeg de Homebrew).

Appelé par server/ffmpeg.ts (encoderVignette) : python webp.py --entree image.png --sortie vignette.webp --qualite 80
"""

import argparse

from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("--entree", required=True)
parser.add_argument("--sortie", required=True)
parser.add_argument("--qualite", type=int, default=80)
args = parser.parse_args()

with Image.open(args.entree) as image:
    image.save(args.sortie, "WEBP", quality=args.qualite, method=6)
