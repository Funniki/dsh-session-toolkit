[CmdletBinding()]
param(
	[string]$Profile = "desktop",
	[switch]$SkipChecks
)

# Installs dsh-session-toolkit and its five components into one DSH profile.
#
# Works for BOTH distribution channels from the same script:
#   * extracted zip  — the five components sit in ./node_modules/ and are
#                      installed from there (link:, keep this folder in place);
#   * npm package    — no bundled copies are present, so the published
#                      @funniki/dsh-session-toolkit-* names are installed from
#                      the registry instead.
#
# Six installs are required either way: a bundle row resolves its `name` from the
# PROFILE root, so the pack alone leaves all five rows unable to import.

$ErrorActionPreference = "Stop"

$pluginRoot = $PSScriptRoot
$packName = "@funniki/dsh-session-toolkit"
$components = @(
	"@funniki/dsh-session-toolkit-archived-session-delete",
	"@funniki/dsh-session-toolkit-session-move",
	"@funniki/dsh-session-toolkit-unsent-content-guard",
	"@funniki/dsh-session-toolkit-session-history-search",
	"@funniki/dsh-session-toolkit-auto-paste"
)

$dsh = @(
	(Join-Path $env:LOCALAPPDATA "Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"),
	(Join-Path $env:ProgramFiles "DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd")
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $dsh) {
	$command = Get-Command dsh -ErrorAction SilentlyContinue
	if ($command) {
		$dsh = $command.Source
	}
}
if (-not $dsh) {
	throw "DeepSeek Harness CLI was not found. Install DSH or put dsh on PATH."
}

if (-not (Test-Path -LiteralPath (Join-Path $pluginRoot "package.json"))) {
	throw "package.json is missing next to install.ps1."
}

function Add-ProfilePackage {
	param([Parameter(Mandatory)][string]$Target)
	Write-Host "Adding $Target"
	& $dsh plugin --profile $Profile add $Target
	if ($LASTEXITCODE -ne 0) {
		throw "dsh plugin add failed for $Target (exit $LASTEXITCODE)."
	}
}

# The pack itself: this folder when it is a local package, the registry otherwise.
if ((Get-Content -LiteralPath (Join-Path $pluginRoot "package.json") -Raw | ConvertFrom-Json).name -eq $packName) {
	Add-ProfilePackage -Target $pluginRoot
} else {
	Add-ProfilePackage -Target $packName
}

foreach ($component in $components) {
	$bundled = Join-Path $pluginRoot "node_modules/$component"
	if (Test-Path -LiteralPath (Join-Path $bundled "package.json")) {
		Add-ProfilePackage -Target $bundled
	} else {
		Add-ProfilePackage -Target $component
	}
}

if ($SkipChecks) {
	Write-Host ""
	Write-Host "Installed into profile '$Profile' (post-install checks skipped)."
	return
}

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME ".dsh" }
$profileDir = Join-Path (Join-Path $dshHome "profiles") $Profile
$profileManifestPath = Join-Path $profileDir "package.json"
$lockfilePath = Join-Path $profileDir "pnpm-lock.yaml"

if (-not (Test-Path -LiteralPath $profileManifestPath)) {
	throw "Profile manifest not found: $profileManifestPath"
}

$manifest = Get-Content -LiteralPath $profileManifestPath -Raw | ConvertFrom-Json
$bundles = @($manifest.dsh.profile.bundles)
if ($bundles -notcontains $packName) {
	throw "Profile did not register $packName as a bundle."
}
foreach ($component in $components) {
	if (-not $manifest.dependencies.PSObject.Properties[$component]) {
		throw "Profile dependency was not recorded: $component"
	}
}

# The whole point of 0.1.0: no Harness core copy inside the profile.
$duplicateCore = Join-Path $profileDir "node_modules\@deepseek-ai\dsh-tools"
if (Test-Path -LiteralPath $duplicateCore) {
	throw "Duplicate core package detected: $duplicateCore. Remove it before starting DSH."
}
if ((Test-Path -LiteralPath $lockfilePath) -and
	((Get-Content -LiteralPath $lockfilePath -Raw) -match "(?m)^\s*'@deepseek-ai/dsh-tools@")) {
	throw "pnpm-lock.yaml still resolves @deepseek-ai/dsh-tools at the profile root."
}

Write-Host ""
Write-Host "Installed $packName and all five components into profile '$Profile'."
Write-Host "Restart DSH, or disable and re-enable the bundle in Plugins if it is already running."
