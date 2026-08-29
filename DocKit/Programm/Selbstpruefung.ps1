#Requires -Version 5.1
<#
    Prüft DocKit.ps1 auf Fehlerbilder, die eine reine Syntaxprüfung übersieht.

    Aufruf ohne Argumente. Rückgabe 0, wenn nichts beanstandet wird.

    Warum es das braucht: PowerShell nimmt manche Fehler klaglos hin. Ein
    typografisches Anführungszeichen beendet eine Zeichenkette vorzeitig, der
    Rest der Zeile wird zu Text — der Code bleibt gültig und bedeutet etwas
    anderes. Solche Fälle findet nur ein Blick in den Syntaxbaum.
#>

# Ohne Angabe wird die DocKit.ps1 daneben geprüft. Der Parameter dient der
# Gegenprobe: die Abfragen an einer absichtlich fehlerhaften Kopie erproben.
param([string]$Datei = '')

$ErrorActionPreference = 'Stop'
$skript = if ($Datei) { $Datei } else { Join-Path $PSScriptRoot 'DocKit.ps1' }
if (-not (Test-Path -LiteralPath $skript)) { throw "Nicht gefunden: $skript" }

Write-Host ''
Write-Host '  DocKit — Selbstprüfung' -ForegroundColor Cyan
Write-Host '  -----------------------------------'

$fehler = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($skript, [ref]$null, [ref]$fehler)

$beanstandet = 0
function Melde {
    param([string]$Was, [string[]]$Treffer)
    if ($Treffer.Count -eq 0) {
        Write-Host ("  {0,-42} in Ordnung" -f $Was) -ForegroundColor Green
    } else {
        Write-Host ("  {0,-42} {1}" -f $Was, ($Treffer -join ', ')) -ForegroundColor Yellow
        $global:SelbstpruefungOffen = $true
    }
}

# --- 1. Syntax -----------------------------------------------------------------
if ($fehler.Count -gt 0) {
    Write-Host '  Syntax                                     FEHLER' -ForegroundColor Red
    $fehler | ForEach-Object { Write-Host "    Zeile $($_.Extent.StartLineNumber): $($_.Message)" }
    exit 1
}
Write-Host ('  {0,-42} in Ordnung' -f 'Syntax') -ForegroundColor Green

$global:SelbstpruefungOffen = $false

# --- 2. Zeichenketten über mehrere Zeilen --------------------------------------
# Ein vorzeitig beendetes Anführungszeichen zieht die Zeichenkette über das
# Zeilenende hinaus. Absicht ist das im ganzen Programm nirgends.
$mehrzeilig = @($ast.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and
    $n.Extent.StartLineNumber -ne $n.Extent.EndLineNumber }, $true) |
    ForEach-Object { "Zeile $($_.Extent.StartLineNumber)" })
Melde 'Zeichenketten über mehrere Zeilen' $mehrzeilig

# --- 3. Verschachtelte Closures ------------------------------------------------
# Ein .GetNewClosure() innerhalb eines anderen Closures erbt dessen Variablen
# nicht. Entscheidend ist die Zahl der umgebenden Scriptblöcke: schon einer
# bedeutet, dass der Aufruf in einer fremden Closure steckt. Funktionsrümpfe
# zählen nicht mit — die sind ein ScriptBlockAst, kein ScriptBlockExpressionAst.
$verschachtelt = New-Object System.Collections.ArrayList
foreach ($c in $ast.FindAll({ param($n)
        $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and
        $n.Member.Value -eq 'GetNewClosure' }, $true)) {
    $tiefe = 0
    $eltern = $c.Parent
    while ($eltern) {
        if ($eltern -is [System.Management.Automation.Language.ScriptBlockExpressionAst]) { $tiefe++ }
        $eltern = $eltern.Parent
    }
    if ($tiefe -ge 1) { [void]$verschachtelt.Add("Zeile $($c.Extent.StartLineNumber)") }
}
Melde 'Verschachtelte Closures' @($verschachtelt)

# --- 4. Nie aufgerufene Funktionen ---------------------------------------------
$erklaert = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
$gerufen  = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() })
Melde 'Nie aufgerufene Funktionen' @($erklaert | Where-Object { $gerufen -notcontains $_ })

# --- 5. $script: statt $global: ------------------------------------------------
# In einer Closure zeigt $script: ins Leere. Geteilte Zustände sind deshalb
# durchgängig $global:; Treffer außerhalb des Kopfkommentars sind ein Fehler.
$zeilen = Get-Content $skript -Encoding UTF8
$reste = New-Object System.Collections.ArrayList
for ($i = 0; $i -lt $zeilen.Count; $i++) {
    if ($zeilen[$i] -match '\$script:' -and $zeilen[$i] -notmatch '^\s*[#\s]') { [void]$reste.Add("Zeile $($i + 1)") }
}
Melde '$script: außerhalb der Erläuterung' @($reste)

Write-Host ''
if ($global:SelbstpruefungOffen) {
    Write-Host '  Es gibt Beanstandungen — bitte vor dem Bauen ansehen.' -ForegroundColor Yellow
    exit 1
}
Write-Host '  Keine Beanstandung.' -ForegroundColor Green
exit 0
