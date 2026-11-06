[CmdletBinding()]
param(
	[string]$Profile = "desktop"
)

$ErrorActionPreference = "Stop"

$pluginRoot = $PSScriptRoot
$components = @(
	"dsh-archived-session-delete",
	"dsh-session-move",
	"dsh-unsent-content-guard",
	"dsh-session-history-search",
	"dsh-auto-paste"
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
	param([Parameter(Mandatory)][string]$Path)
	Write-Host "Adding $Path"
	& $dsh plugin --profile $Profile add $Path
	if ($LASTEXITCODE -ne 0) {
		throw "dsh plugin add failed for $Path (exit $LASTEXITCODE)."
	}
}

Add-ProfilePackage -Path $pluginRoot
foreach ($component in $components) {
	$componentPath = Join-Path $pluginRoot "node_modules\$component"
	if (-not (Test-Path -LiteralPath (Join-Path $componentPath "package.json"))) {
		throw "Bundled component is missing: $componentPath"
	}
	Add-ProfilePackage -Path $componentPath
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
if ($bundles -notcontains "dsh-session-toolkit") {
	throw "Profile did not register dsh-session-toolkit as a bundle."
}
foreach ($component in $components) {
	if (-not $manifest.dependencies.PSObject.Properties[$component]) {
		throw "Profile dependency was not recorded: $component"
	}
}

$topLevelTools = Join-Path $profileDir "node_modules\@deepseek-ai\dsh-tools"
if (Test-Path -LiteralPath $topLevelTools) {
	throw "Duplicate core package detected: $topLevelTools. Remove it before starting DSH."
}
if ((Test-Path -LiteralPath $lockfilePath) -and
	((Get-Content -LiteralPath $lockfilePath -Raw) -match "(?m)^\s*'@deepseek-ai/dsh-tools@")) {
	throw "pnpm-lock.yaml still resolves @deepseek-ai/dsh-tools at the profile root."
}

Write-Host ""
Write-Host "Installed dsh-session-toolkit and all five components into profile '$Profile'."
Write-Host "Restart DSH, or disable and re-enable the bundle in Plugins if it is already running."
