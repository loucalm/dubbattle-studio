// Fenêtres « Ouvrir » natives de Windows (avec l'accès rapide, les dossiers épinglés…), ouvertes
// par le serveur local. Ailleurs que sous Windows, l'interface garde son explorateur intégré.

import { executer } from "./processus.ts";

export type TypeDialogue = "video" | "audio" | "dossier";

const FILTRES: Record<Exclude<TypeDialogue, "dossier">, string> = {
  video: "Vidéos|*.mp4;*.mkv;*.mov;*.webm;*.m4v;*.avi;*.ts;*.m2ts;*.mpg;*.mpeg;*.wmv;*.flv|Tous les fichiers|*.*",
  audio: "Audio|*.wav;*.flac;*.aif;*.aiff;*.mp3;*.m4a;*.aac;*.ogg;*.opus|Tous les fichiers|*.*",
};

// Sélecteur de dossier moderne (IFileOpenDialog avec FOS_PICKFOLDERS) : le FolderBrowserDialog
// de .NET Framework est l'ancienne arborescence, sans accès rapide.
const CHOIX_DOSSIER = `
using System;
using System.Runtime.InteropServices;
public static class ChoixDossier {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogRCW {}
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint n, IntPtr filtres);
    void SetFileTypeIndex(uint i);
    void GetFileTypeIndex(out uint i);
    void Advise(IntPtr p, out uint c);
    void Unadvise(uint c);
    void SetOptions(uint fos);
    void GetOptions(out uint fos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem psi);
    void GetCurrentSelection(out IShellItem psi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string nom);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string nom);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string titre);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string texte);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string texte);
    void GetResult(out IShellItem psi);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem psi);
    void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string nom);
  }
  public static string Choisir(IntPtr parent, string titre) {
    IFileDialog d = (IFileDialog)new FileOpenDialogRCW();
    uint options;
    d.GetOptions(out options);
    d.SetOptions(options | 0x20 | 0x40); // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM
    d.SetTitle(titre);
    if (d.Show(parent) != 0) return null;
    IShellItem item;
    d.GetResult(out item);
    string chemin;
    item.GetDisplayName(0x80058000, out chemin); // SIGDN_FILESYSPATH
    return chemin;
  }
}`;

function script(type: TypeDialogue, titre: string): string {
  const texte = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const debut = `
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
# fenêtre invisible au premier plan : la boîte de dialogue s'ouvre devant le navigateur
$proprio = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0; StartPosition = 'CenterScreen' }
$proprio.Show(); $proprio.Activate()
`;
  if (type === "dossier") {
    return `${debut}
Add-Type -TypeDefinition @'
${CHOIX_DOSSIER}
'@
$chemin = [ChoixDossier]::Choisir($proprio.Handle, ${texte(titre)})
$proprio.Close()
if ($chemin) { Write-Output "CHEMIN:$chemin" }
`;
  }
  return `${debut}
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = ${texte(titre)}
$d.Filter = ${texte(FILTRES[type])}
$resultat = $d.ShowDialog($proprio)
$proprio.Close()
if ($resultat -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output "CHEMIN:$($d.FileName)" }
`;
}

export const dialoguesDisponibles = process.platform === "win32";

let enCours: Promise<string | null> | null = null;

/** Ouvre la fenêtre native et attend le choix. null si l'utilisateur annule. */
export function ouvrirDialogue(type: TypeDialogue, titre: string): Promise<string | null> {
  if (!dialoguesDisponibles) return Promise.reject(new Error("Fenêtre native disponible sous Windows seulement."));
  // une seule fenêtre à la fois : un double clic ne doit pas en ouvrir deux
  if (enCours) return enCours;
  const commande = Buffer.from(script(type, titre), "utf16le").toString("base64");
  enCours = executer("powershell.exe", ["-NoProfile", "-STA", "-NonInteractive", "-EncodedCommand", commande])
    // la réponse est balisée : PowerShell peut écrire d'autres choses sur sa sortie
    .then(({ stdout }) => /^CHEMIN:(.+)$/m.exec(stdout)?.[1].trim() || null)
    .finally(() => (enCours = null));
  return enCours;
}
