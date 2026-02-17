$ErrorActionPreference = "Stop"

function Get-JsonNodeType {
	param(
		[Parameter(Mandatory = $false)]
		$Value
	)
	if ($null -eq $Value) { return "null" }
	if ($Value -is [System.Collections.IDictionary]) { return "object" }
	if ($Value -is [pscustomobject]) { return "object" }
	if (($Value -is [System.Collections.IList]) -and -not ($Value -is [string])) { return "array" }
	return $Value.GetType().Name.ToLowerInvariant()
}

function Get-JsonKeyMap {
	param(
		[Parameter(Mandatory = $true)]
		$Node,
		[Parameter(Mandatory = $false)]
		[string]$Prefix = ""
	)

	$map = @{}
	if ((Get-JsonNodeType -Value $Node) -ne "object") { return $map }

	$entries = @()
	if ($Node -is [System.Collections.IDictionary]) {
		foreach ($entry in $Node.GetEnumerator()) {
			$entries += [pscustomobject]@{ Key = [string]$entry.Key; Value = $entry.Value }
		}
	} else {
		foreach ($prop in $Node.PSObject.Properties) {
			$entries += [pscustomobject]@{ Key = [string]$prop.Name; Value = $prop.Value }
		}
	}

	foreach ($entry in $entries) {
		$path = if ($Prefix) { "$Prefix.$($entry.Key)" } else { $entry.Key }
		$nodeType = Get-JsonNodeType -Value $entry.Value
		$map[$path] = $nodeType
		if ($nodeType -eq "object") {
			$childMap = Get-JsonKeyMap -Node $entry.Value -Prefix $path
			foreach ($childKey in $childMap.Keys) {
				$map[$childKey] = $childMap[$childKey]
			}
		}
	}

	return $map
}

function Read-JsonFile {
	param(
		[Parameter(Mandatory = $true)]
		[string]$Path
	)
	try {
		return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
	} catch {
		throw "Unable to parse JSON at '$Path': $($_.Exception.Message)"
	}
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$scriptsDir = Join-Path $repoRoot "scripts"
$langDir = Join-Path $repoRoot "lang"

Write-Host "Running pre-release checks from '$repoRoot'..."

# 1) Syntax checks
$syntaxFailures = @()
$scriptFiles = Get-ChildItem -LiteralPath $scriptsDir -Filter *.mjs -File | Sort-Object Name

foreach ($file in $scriptFiles) {
	& node --check $file.FullName | Out-Null
	if ($LASTEXITCODE -ne 0) {
		$syntaxFailures += $file.FullName
	}
}

Write-Host ("Syntax check: {0}/{1} passed" -f ($scriptFiles.Count - $syntaxFailures.Count), $scriptFiles.Count)
if ($syntaxFailures.Count -gt 0) {
	foreach ($failure in $syntaxFailures) {
		Write-Host ("  FAIL {0}" -f (Resolve-Path -Relative $failure)) -ForegroundColor Red
	}
	throw "Syntax checks failed."
}

# 2) Locale parity checks (vs en.json)
$enPath = Join-Path $langDir "en.json"
$enData = Read-JsonFile -Path $enPath
$enMap = Get-JsonKeyMap -Node $enData

$localeFailures = $false
$localeFiles = Get-ChildItem -LiteralPath $langDir -Filter *.json -File | Where-Object { $_.Name -ne "en.json" } | Sort-Object Name
Write-Host ("Locale parity check: comparing {0} locale files to lang/en.json" -f $localeFiles.Count)

foreach ($localeFile in $localeFiles) {
	$localeData = Read-JsonFile -Path $localeFile.FullName
	$localeMap = Get-JsonKeyMap -Node $localeData

	$missing = @($enMap.Keys | Where-Object { -not $localeMap.ContainsKey($_) })
	$extra = @($localeMap.Keys | Where-Object { -not $enMap.ContainsKey($_) })
	$typeMismatch = @(
		$enMap.Keys | Where-Object {
			$localeMap.ContainsKey($_) -and ($localeMap[$_] -ne $enMap[$_])
		}
	)

	if (($missing.Count -eq 0) -and ($extra.Count -eq 0) -and ($typeMismatch.Count -eq 0)) {
		Write-Host ("  OK   {0}: missing=0, extra=0, typeMismatch=0" -f $localeFile.Name)
		continue
	}

	$localeFailures = $true
	Write-Host ("  FAIL {0}: missing={1}, extra={2}, typeMismatch={3}" -f $localeFile.Name, $missing.Count, $extra.Count, $typeMismatch.Count) -ForegroundColor Red
	if ($missing.Count -gt 0) {
		Write-Host ("    missing keys: {0}" -f (($missing | Select-Object -First 20) -join ", "))
	}
	if ($extra.Count -gt 0) {
		Write-Host ("    extra keys: {0}" -f (($extra | Select-Object -First 20) -join ", "))
	}
	if ($typeMismatch.Count -gt 0) {
		$preview = $typeMismatch | Select-Object -First 20 | ForEach-Object { "$_ ($($localeMap[$_]) vs $($enMap[$_]))" }
		Write-Host ("    type mismatches: {0}" -f ($preview -join ", "))
	}
}

if ($localeFailures) {
	throw "Locale parity checks failed."
}

Write-Host ""
Write-Host "Pre-release checks passed." -ForegroundColor Green
