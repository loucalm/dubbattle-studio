// Installe l'environnement Python du Studio dans studio/.venv (Python 3.12, avec uv).
// - Carte NVIDIA détectée : torch CUDA 12.8 et onnxruntime-gpu 1.22 (build CUDA 12, compatible
//   avec les DLL CUDA fournies par torch). Sinon : versions processeur.
// - faster-whisper installe onnxruntime (processeur), qui masquerait onnxruntime-gpu : on le retire.
// Usage : npm run python:installer [-- --cpu]
//         npm run ytdlp:maj (met seulement yt-dlp à jour, à faire quand YouTube casse le téléchargement)

import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const python = join(racine, ".venv", windows ? "Scripts/python.exe" : "bin/python");

function lancer(commande, args) {
  console.log(`\n> ${commande} ${args.join(" ")}`);
  const r = spawnSync(commande, args, { cwd: racine, stdio: "inherit", shell: false });
  if (r.status !== 0) {
    console.error(`\nÉchec de : ${commande} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

function existe(commande) {
  try {
    execSync(windows ? `where ${commande}` : `command -v ${commande}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!existe("uv")) {
  console.error("uv est introuvable. Installe-le d'abord : winget install astral-sh.uv (ou pip install uv).");
  process.exit(1);
}

if (!existsSync(python)) lancer("uv", ["venv", ".venv", "--python", "3.12"]);
const pip = (...args) => lancer("uv", ["pip", "install", "--python", python, ...args]);

if (process.argv.includes("--ytdlp")) {
  pip("--upgrade", "yt-dlp[default]");
  console.log("\nyt-dlp à jour.");
  process.exit(0);
}

const gpu = !process.argv.includes("--cpu") && existe("nvidia-smi");
console.log(gpu ? "Carte NVIDIA détectée : installation GPU (CUDA 12.8)." : "Installation processeur (sans GPU).");

pip("torch", "--index-url", `https://download.pytorch.org/whl/${gpu ? "cu128" : "cpu"}`);
pip("-r", "python/requirements.txt");
if (gpu) {
  lancer("uv", ["pip", "uninstall", "--python", python, "onnxruntime"]);
  pip("--reinstall-package", "onnxruntime-gpu", "onnxruntime-gpu==1.22.0");
}

lancer(python, [join("python", "outils.py")]);
console.log("\nEnvironnement Python prêt.");
