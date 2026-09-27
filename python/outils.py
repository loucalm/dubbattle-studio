"""État de l'environnement Python du Studio (appelé au démarrage par server/python.ts)."""

import importlib.metadata as metadata
import json
import platform


def version(paquet):
    try:
        return metadata.version(paquet)
    except metadata.PackageNotFoundError:
        return None


cuda = False
try:
    import torch

    cuda = bool(torch.cuda.is_available())
except Exception:
    pass

print(
    json.dumps(
        {
            "python": platform.python_version(),
            "audio_separator": version("audio-separator"),
            "faster_whisper": version("faster-whisper"),
            "cuda": cuda,
        }
    )
)
