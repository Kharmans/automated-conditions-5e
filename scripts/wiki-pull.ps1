param(
  [string]$Repo = "thatlonelybugbear/automated-conditions-5e",
  [string]$WikiPath = "wiki"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$wikiDir = Join-Path $repoRoot $WikiPath
$wikiUrl = "https://github.com/$Repo.wiki.git"
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ac5e-wiki-" + [guid]::NewGuid().ToString("N"))

Write-Host "Cloning wiki from $wikiUrl ..."
try {
  git clone --depth 1 $wikiUrl $tmpDir | Out-Host

  if (-not (Test-Path $wikiDir)) {
    New-Item -ItemType Directory -Path $wikiDir -Force | Out-Null
  }

  Write-Host "Mirroring wiki content into $wikiDir ..."
  $source = $tmpDir.TrimEnd("\")
  $destination = $wikiDir.TrimEnd("\")
  $excludeGitPath = Join-Path $tmpDir ".git"

  & robocopy $source $destination /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 /XD $excludeGitPath | Out-Host
  $robocopyExitCode = $LASTEXITCODE
  if ($robocopyExitCode -ge 8) {
    throw "Robocopy failed with exit code $robocopyExitCode."
  }

  Write-Host "Wiki sync complete. Local files are now in: $wikiDir"
  Write-Host "Next step: commit the 'wiki/' folder so changes can be published by the workflow."
} finally {
  if (Test-Path $tmpDir) {
    Remove-Item -LiteralPath $tmpDir -Recurse -Force
  }
}
