<#
.SYNOPSIS
  Installe Atelier Tab sous Windows pour l'utilisateur courant (sans droits d'administrateur).

.DESCRIPTION
  Commande unique de la Suite Atelier (docs/SUITE.md §9.1) :

    powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1

  1. vérifie les prérequis (Git, Node.js 22.12 ou plus récent avec npm) et dit comment installer
     ce qui manque (winget), sans rien installer de système ;
  2. fait la première mise à jour (npm ci si besoin, compilation) avec le lanceur du dépôt
     (desktop\launcher\cli.cjs : même logique, même verrou et même tampon que l'app) ;
  3. construit le lanceur (electron-builder, dossier release\win-unpacked) et le copie dans
     %LOCALAPPDATA%\Programs\Atelier_Tab ;
  4. crée les raccourcis « Atelier Tab » : menu Démarrer (dossier « Atelier ») et Bureau ;
  5. inscrit l'app dans HKCU\Software\Atelier\Apps\tab pour les autres apps de la suite (§9.4,
     §9.6) : Lanceur = raccourci .lnk du menu Démarrer (ouvert par explorer.exe), Nom ;
  6. connecte Claude Code au serveur MCP livré, s'il est installé.

  L'app installée est un lanceur : elle exécute le code de ce dépôt. Après un « git pull », il
  suffit de la relancer : elle se met à jour toute seule (§8). Relancer cette commande répare
  l'installation. Les données (%USERPROFILE%\Atelier_Tab, %APPDATA%\Atelier_Tab) ne sont jamais
  touchées, ni à l'installation ni à la désinstallation.

.PARAMETER SansBureau
  Ne crée pas de raccourci sur le Bureau (et retire celui d'une installation précédente).

.PARAMETER Desinstaller
  Retire le lanceur, les raccourcis, l'enregistrement et la connexion à Claude Code. Jamais les
  données ni le dépôt.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1 -SansBureau
#>
[CmdletBinding()]
param(
  [switch]$SansBureau,
  [switch]$Desinstaller
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

$NomAffiche = 'Atelier Tab'
$NomTechnique = 'Atelier_Tab'
$CleRegistre = 'HKCU:\Software\Atelier\Apps\tab'
$NodeMinimum = [version]'22.12.0'

$Depot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).ProviderPath
if (-not $env:LOCALAPPDATA -or -not $env:APPDATA) {
  Write-Host '✗ Variables LOCALAPPDATA / APPDATA absentes : session Windows inhabituelle.' -ForegroundColor Red
  exit 1
}
$Programmes = Join-Path $env:LOCALAPPDATA 'Programs'
$Destination = Join-Path $Programmes $NomTechnique
$Exe = Join-Path $Destination "$NomTechnique.exe"
$Ressources = Join-Path $Destination 'resources'
$DossierMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Atelier'
$RaccourciMenu = Join-Path $DossierMenu "$NomAffiche.lnk"
$Bureau = [Environment]::GetFolderPath('Desktop')
$RaccourciBureau = if ($Bureau) { Join-Path $Bureau "$NomAffiche.lnk" } else { $null }

function Write-Etape([string]$Texte) { Write-Host "`n→ $Texte" -ForegroundColor Cyan }
function Write-Ok([string]$Texte) { Write-Host "✓ $Texte" -ForegroundColor Green }
function Write-Note([string]$Texte) { Write-Host "  $Texte" }
function Stop-Installation([string]$Texte) {
  Write-Host "`n✗ $Texte" -ForegroundColor Red
  exit 1
}

# Commande externe à arguments fixes (jamais de ligne de commande construite) ; sa sortie est
# affichée (jamais renvoyée) et son code de sortie est rendu. Sa sortie d'erreur n'est pas une
# erreur PowerShell (Windows PowerShell 5.1 la transforme sinon en exception).
function Invoke-Natif([string]$Fichier, [string[]]$Arguments) {
  $avant = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Fichier @Arguments 2>&1 | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) { Write-Host $_.Exception.Message }
      else { Write-Host $_ }
    }
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $avant
  }
}

# Renommage réessayé : un antivirus analyse souvent une copie toute neuve.
function Rename-AvecReessai([string]$Chemin, [string]$NouveauNom) {
  for ($i = 1; $i -le 10; $i++) {
    try {
      Rename-Item -LiteralPath $Chemin -NewName $NouveauNom
      return
    } catch {
      if ($i -eq 10) { throw }
      Start-Sleep -Milliseconds (300 * $i)
    }
  }
}

function Remove-Dossier([string]$Chemin) {
  if (Test-Path -LiteralPath $Chemin) {
    Remove-Item -LiteralPath $Chemin -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Ferme Atelier Tab (et ses serveurs MCP) lancée depuis le dossier d'installation.
function Stop-App {
  $prefixe = $Destination.TrimEnd('\') + '\'
  $enCours = @(Get-Process -Name $NomTechnique -ErrorAction SilentlyContinue | Where-Object {
      $chemin = $null
      try { $chemin = $_.Path } catch { }
      $chemin -and $chemin.StartsWith($prefixe, [System.StringComparison]::OrdinalIgnoreCase)
    })
  if ($enCours.Count -eq 0) { return }
  Write-Note "$NomAffiche est ouverte : fermeture…"
  foreach ($p in $enCours) { try { [void]$p.CloseMainWindow() } catch { } }
  foreach ($p in $enCours) {
    try {
      if (-not $p.WaitForExit(10000)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    } catch { }
  }
  Start-Sleep -Milliseconds 500
}

function Get-Node {
  $commande = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $commande) { return $null }
  return $commande.Path
}

# ---------------------------------------------------------------------------
# Désinstallation
# ---------------------------------------------------------------------------

if ($Desinstaller) {
  Write-Host "Désinstallation d'$NomAffiche (les données sont conservées)."
  Stop-App
  Remove-Dossier $Destination
  Remove-Dossier "$Destination.nouveau"
  Remove-Dossier "$Destination.ancien"
  foreach ($lnk in @($RaccourciMenu, $RaccourciBureau)) {
    if ($lnk -and (Test-Path -LiteralPath $lnk)) { Remove-Item -LiteralPath $lnk -Force }
  }
  if ((Test-Path -LiteralPath $DossierMenu) -and -not (Get-ChildItem -LiteralPath $DossierMenu -Force)) {
    Remove-Item -LiteralPath $DossierMenu -Force
  }
  if (Test-Path -LiteralPath $CleRegistre) { Remove-Item -LiteralPath $CleRegistre -Recurse -Force }
  $node = Get-Node
  if ($node) {
    [void](Invoke-Natif $node @((Join-Path $Depot 'scripts\connect-claude.mjs'), '--retirer'))
  }
  if (Test-Path -LiteralPath $Destination) {
    Write-Host "! Un fichier de $Destination est encore utilisé : supprimez ce dossier plus tard." -ForegroundColor Yellow
  }
  Write-Ok "$NomAffiche est désinstallée."
  Write-Note "Vos données restent dans $(Join-Path $env:USERPROFILE 'Atelier_Tab') (préférences : $(Join-Path $env:APPDATA 'Atelier_Tab'))."
  Write-Note "Le dépôt n'est pas touché : $Depot"
  exit 0
}

# ---------------------------------------------------------------------------
# Prérequis (§9.1) : rien n'est installé ici, seulement vérifié.
# ---------------------------------------------------------------------------

Write-Host "Installation d'$NomAffiche pour $env:USERNAME (dépôt : $Depot)"
Write-Etape 'Vérification des prérequis…'
$manque = New-Object System.Collections.Generic.List[string]

if (-not (Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue)) {
  $manque.Add('Git introuvable. Installez-le : winget install --id Git.Git -e')
}

$Node = Get-Node
$NpmCli = $null
if (-not $Node) {
  $manque.Add('Node.js introuvable. Installez-le : winget install --id OpenJS.NodeJS.LTS -e')
} else {
  $texte = (& $Node --version 2>$null | Out-String).Trim()
  $version = $null
  if ($texte -match '^v?(\d+)\.(\d+)\.(\d+)') { $version = [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" }
  if (-not $version -or $version -lt $NodeMinimum) {
    $manque.Add("Node.js $texte trop ancien ($Node) : 22.12 ou plus récent requis. Mettez-le à jour : winget upgrade --id OpenJS.NodeJS.LTS -e")
  }
  # npm lancé par node.exe (comme le lanceur de l'app), jamais npm.cmd.
  $NpmCli = Join-Path (Split-Path -Parent $Node) 'node_modules\npm\bin\npm-cli.js'
  if (-not (Test-Path -LiteralPath $NpmCli)) {
    $manque.Add("npm introuvable à côté de Node.js ($NpmCli). Réinstallez Node.js : winget install --id OpenJS.NodeJS.LTS -e")
  }
}

if ($manque.Count -gt 0) {
  Write-Host ''
  foreach ($m in $manque) { Write-Host "✗ $m" -ForegroundColor Red }
  Write-Host ''
  Write-Note 'Ensuite, ouvrez une nouvelle fenêtre PowerShell (pour relire le PATH) et relancez :'
  Write-Note '  powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1'
  exit 1
}
Write-Ok "Git, Node.js $((& $Node --version | Out-String).Trim()) et npm présents."

function Invoke-Npm([string[]]$Arguments) {
  return Invoke-Natif $Node (@($NpmCli) + $Arguments)
}

Push-Location -LiteralPath $Depot
try {
  # -------------------------------------------------------------------------
  # Première mise à jour (npm ci si besoin, compilation) : même logique que l'app.
  # -------------------------------------------------------------------------
  Write-Etape 'Mise à jour de la compilation…'
  $code = Invoke-Natif $Node @((Join-Path $Depot 'desktop\launcher\cli.cjs'))
  if ($code -ne 0) {
    Stop-Installation "Installation interrompue : corrigez l'erreur ci-dessus, puis relancez la commande. Rien n'a été installé."
  }

  # -------------------------------------------------------------------------
  # Lanceur (electron-builder) : Electron du dépôt, renommé, avec l'icône d'Atelier Tab.
  # -------------------------------------------------------------------------
  Write-Etape 'Construction du lanceur…'
  $code = Invoke-Npm @('run', 'app:build')
  if ($code -ne 0) { Stop-Installation "La construction du lanceur a échoué (code $code)." }
  $source = Get-ChildItem -LiteralPath (Join-Path $Depot 'release') -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'win*-unpacked' -and (Test-Path -LiteralPath (Join-Path $_.FullName "$NomTechnique.exe")) } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $source) { Stop-Installation "Lanceur introuvable dans $(Join-Path $Depot 'release')." }
} finally {
  Pop-Location
}

# ---------------------------------------------------------------------------
# Copie dans %LOCALAPPDATA%\Programs\Atelier_Tab (à côté, puis échange de dossiers).
# ---------------------------------------------------------------------------

Write-Etape "Installation dans $Destination…"
Stop-App
New-Item -ItemType Directory -Path $Programmes -Force | Out-Null
$nouveau = "$Destination.nouveau"
$ancien = "$Destination.ancien"
Remove-Dossier $nouveau
Remove-Dossier $ancien
Copy-Item -LiteralPath $source.FullName -Destination $nouveau -Recurse
try {
  if (Test-Path -LiteralPath $Destination) { Rename-AvecReessai $Destination (Split-Path -Leaf $ancien) }
  Rename-AvecReessai $nouveau $NomTechnique
} catch {
  if (-not (Test-Path -LiteralPath $Destination) -and (Test-Path -LiteralPath $ancien)) {
    Rename-Item -LiteralPath $ancien -NewName $NomTechnique
  }
  Stop-Installation "Impossible de remplacer $Destination : un fichier est encore utilisé ($($_.Exception.Message)). Fermez $NomAffiche et Claude Code, puis relancez."
}
Remove-Dossier $ancien
Write-Ok "Lanceur : $Exe"

# ---------------------------------------------------------------------------
# Raccourcis : menu Démarrer (dossier « Atelier ») et Bureau.
# ---------------------------------------------------------------------------

function New-Raccourci([string]$Chemin) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $Chemin) -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($Chemin)
  $lnk.TargetPath = $Exe
  $lnk.WorkingDirectory = $Destination
  $lnk.IconLocation = "$(Join-Path $Ressources 'icon.ico'),0"
  $lnk.Description = 'Tableur et base de données de la Suite Atelier'
  $lnk.Save()
}

Write-Etape 'Raccourcis…'
New-Raccourci $RaccourciMenu
Write-Ok "Menu Démarrer : Atelier › $NomAffiche"
if ($SansBureau) {
  if ($RaccourciBureau -and (Test-Path -LiteralPath $RaccourciBureau)) { Remove-Item -LiteralPath $RaccourciBureau -Force }
} elseif ($RaccourciBureau) {
  New-Raccourci $RaccourciBureau
  Write-Ok 'Bureau : raccourci créé.'
}

# ---------------------------------------------------------------------------
# Inscription pour les autres apps de la suite (§9.4, §9.6) : Lanceur = raccourci du menu
# Démarrer, que les autres apps ouvrent par explorer.exe.
# ---------------------------------------------------------------------------

if (-not (Test-Path -LiteralPath $CleRegistre)) { New-Item -Path $CleRegistre -Force | Out-Null }
New-ItemProperty -LiteralPath $CleRegistre -Name 'Lanceur' -Value $RaccourciMenu -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath $CleRegistre -Name 'Nom' -Value $NomAffiche -PropertyType String -Force | Out-Null
Write-Ok 'Enregistrée pour la Suite Atelier (HKCU\Software\Atelier\Apps\tab).'

# ---------------------------------------------------------------------------
# Claude Code (facultatif) : serveur MCP livré avec l'app.
# ---------------------------------------------------------------------------

Write-Etape 'Claude Code…'
$code = Invoke-Natif $Node @((Join-Path $Depot 'scripts\connect-claude.mjs'), '--si-present')
if ($code -ne 0) { Write-Host '! Connexion à Claude Code impossible : réessayez plus tard avec « npm run ai:connect ».' -ForegroundColor Yellow }
Write-Note "Serveur MCP (chemin stable) : $(Join-Path $Ressources 'atelier-mcp.cmd')"

Write-Host ''
Write-Ok "$NomAffiche est installée."
Write-Note 'Ouvrez-la depuis le menu Démarrer (Atelier › Atelier Tab).'
Write-Note 'Après un « git pull », relancez simplement l''app : elle se met à jour toute seule.'
Write-Note "Données : $(Join-Path $env:USERPROFILE 'Atelier_Tab')"
exit 0
