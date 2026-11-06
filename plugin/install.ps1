[CmdletBinding()]
param(
	[string]$Profile = "desktop",
	[switch]$SkipChecks
)

# Installs the pack into one DSH profile, one command, both channels.
#
# Since 0.1.1 the pack declares the five components as its own dependencies, and
# DSH profiles install with `nodeLinker: hoisted` — so the components land at the
# profile ROOT, which is exactly where a bundle row resolves its `name`. That is
# why installing the pack alone is enough now (0.1.0 needed six separate adds).
#
# This script therefore:
#   1. installs the pack (from this folder when it is the extracted zip, from the
#      registry when it came out of npm);
#   2. checks that all five rows are resolvable from the profile root;
#   3. only if one is not (a profile switched to the isolated linker), installs
#      that component explicitly as a fallback.

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

# 1. The pack: this folder when it is the extracted zip, the registry otherwise.
$thisPackage = Get-Content -LiteralPath (Join-Path $pluginRoot "package.json") -Raw | ConvertFrom-Json
if ($thisPackage.name -eq $packName) {
	Add-ProfilePackage -Target $pluginRoot
} else {
	Add-ProfilePackage -Target $packName
}

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME ".dsh" }
$profileDir = Join-Path (Join-Path $dshHome "profiles") $Profile
$nodeModules = Join-Path $profileDir "node_modules"

# 2. Do all five rows resolve from the profile root? (That is where the loader looks.)
$missing = @()
foreach ($component in $components) {
	if (-not (Test-Path -LiteralPath (Join-Path $nodeModules $component))) {
		$missing += $component
	}
}

# 3. Fallback for a profile that is not hoisted: install each missing component.
if ($missing.Count -gt 0) {
	Write-Host ""
	Write-Host "These components did not arrive with the pack (profile is not using the hoisted linker):"
	foreach ($component in $missing) { Write-Host "  $component" }
	foreach ($component in $missing) {
		$bundled = Join-Path $pluginRoot "node_modules/$component"
		if (Test-Path -LiteralPath (Join-Path $bundled "package.json")) {
			Add-ProfilePackage -Target $bundled
		} else {
			Add-ProfilePackage -Target $component
		}
	}
}

if ($SkipChecks) {
	Write-Host ""
	Write-Host "Installed $packName into profile '$Profile' (post-install checks skipped)."
	return
}

$profileManifestPath = Join-Path $profileDir "package.json"
if (-not (Test-Path -LiteralPath $profileManifestPath)) {
	throw "Profile manifest not found: $profileManifestPath"
}
$manifest = Get-Content -LiteralPath $profileManifestPath -Raw | ConvertFrom-Json
if (-not (($manifest.dsh.profile.bundles) -contains $packName)) {
	throw "Profile did not register $packName as a bundle."
}
foreach ($component in $components) {
	if (-not (Test-Path -LiteralPath (Join-Path $nodeModules $component))) {
		throw "Component is still not resolvable from the profile root: $component"
	}
}

# The whole point of 0.1.x: no Harness core copy inside the profile.
$duplicateCore = Join-Path $nodeModules "@deepseek-ai\dsh-tools"
if (Test-Path -LiteralPath $duplicateCore) {
	throw "Duplicate core package detected: $duplicateCore. Remove it before starting DSH."
}

Write-Host ""
Write-Host "Installed $packName and its five components into profile '$Profile'."
Write-Host "Restart DSH, or disable and re-enable the bundle in Plugins if it is already running."
