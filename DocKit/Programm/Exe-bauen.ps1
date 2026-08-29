#Requires -Version 5.1
<#
    Baut aus DocKit.ps1 eine einzelne DocKit.exe.

    Ohne Zusatzwerkzeug: Windows bringt den C#-Compiler des .NET Framework mit
    (csc.exe unter C:\Windows\Microsoft.NET). Es wird nichts heruntergeladen und
    nichts installiert.

    Das Skript wird als Base64 in die Programmdatei einkompiliert und beim Start
    in einer PowerShell-Sitzung im selben Prozess ausgeführt. Die .exe braucht
    daneben nur noch den Ordner "Daten".

    Nach jeder Änderung an DocKit.ps1 hier erneut durchlaufen lassen.
#>

$ErrorActionPreference = 'Stop'

$programmOrdner = $PSScriptRoot
$basis          = Split-Path -Parent $programmOrdner
$skriptDatei    = Join-Path $programmOrdner 'DocKit.ps1'
$symbolDatei    = Join-Path $basis 'DocKit.ico'
$zielExe        = Join-Path $basis 'DocKit.exe'

Write-Host ''
Write-Host '  DocKit — Programmdatei bauen' -ForegroundColor Cyan
Write-Host '  -----------------------------------'

if (-not (Test-Path -LiteralPath $skriptDatei)) { throw "Nicht gefunden: $skriptDatei" }

# --- 1. Compiler suchen ---------------------------------------------------------
$csc = $null
foreach ($ordner in @('Framework64', 'Framework')) {
    $kandidat = Join-Path $env:WINDIR "Microsoft.NET\$ordner\v4.0.30319\csc.exe"
    if (Test-Path -LiteralPath $kandidat) { $csc = $kandidat; break }
}
if (-not $csc) { throw 'Der C#-Compiler von Windows wurde nicht gefunden (csc.exe, .NET Framework 4).' }
Write-Host "  Compiler:  $csc"

# --- 2. Skript prüfen, bevor es eingebacken wird --------------------------------
# Die Selbstprüfung nebenan macht mehr als eine Syntaxprüfung: sie findet auch
# Fehlerbilder, die PowerShell klaglos hinnimmt. Schlägt sie an, wird nicht gebaut.
$pruefer = Join-Path $programmOrdner 'Selbstpruefung.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $pruefer | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { throw 'Die Selbstprüfung hat etwas beanstandet — es wird nichts gebaut.' }

# --- 3. Symboldatei frisch zeichnen ---------------------------------------------
<#
    Das Symbol wird hier neu erzeugt, damit es nicht veralten kann: derselbe
    blaue Kreis mit "DK" wie im laufenden Programm, nur in mehreren Größen.
    Windows sucht sich aus der .ico-Datei die passende heraus — Taskleiste,
    Explorer und Alt+Tab brauchen unterschiedliche.

    Eine .ico-Datei ist ein kleines Verzeichnis: ein Kopf, je Bild ein Eintrag
    mit Größe und Fundstelle, dahinter die Bilddaten. Jedes Bild wird hier im
    klassischen Format abgelegt (32 Bit je Punkt, zeilenweise von unten nach
    oben) — das versteht jede Windows-Fassung und auch der Ressourcenbinder
    des Compilers.
#>
Add-Type -AssemblyName System.Drawing

function Zeichne-Symbol {
    param([int]$Kante)
    $bild = New-Object System.Drawing.Bitmap $Kante, $Kante, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bild)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)
    # Ein schmaler Rand, sonst klebt der Kreis am Bildrand und wirkt beschnitten
    $rand = [Math]::Max(1, [int]($Kante / 16))
    # Derselbe Blauton wie $global:Farbe.Akzent im Programm
    $pinsel = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0, 84, 140))
    $g.FillEllipse($pinsel, $rand, $rand, ($Kante - 2 * $rand - 1), ($Kante - 2 * $rand - 1))
    # Größe in Bildpunkten statt Punkt, damit sie nicht an der Auflösung hängt
    $schrift = New-Object System.Drawing.Font('Segoe UI', ($Kante * 0.40), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = 'Center'; $format.LineAlignment = 'Center'
    $g.DrawString('DK', $schrift, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, 0, $Kante, $Kante), $format)
    $schrift.Dispose(); $pinsel.Dispose(); $g.Dispose()
    return $bild
}

# Wandelt ein Bild in den Datenblock um, wie ihn eine .ico-Datei erwartet.
function Bild-In-Symbolblock {
    param([System.Drawing.Bitmap]$Bild)
    $kante = $Bild.Width
    $bereich = New-Object System.Drawing.Rectangle 0, 0, $kante, $kante
    $sperre = $Bild.LockBits($bereich, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $punkte = New-Object byte[] ($kante * $kante * 4)
    [System.Runtime.InteropServices.Marshal]::Copy($sperre.Scan0, $punkte, 0, $punkte.Length)
    $Bild.UnlockBits($sperre)

    $strom = New-Object System.IO.MemoryStream
    $w = New-Object System.IO.BinaryWriter $strom
    # Kopf des Bildes. Die Höhe wird verdoppelt, weil hinter den Farbdaten noch
    # eine Maske steht — die braucht das Format, auch wenn sie hier leer bleibt.
    $w.Write([uint32]40); $w.Write([int32]$kante); $w.Write([int32]($kante * 2))
    $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]0)
    $w.Write([uint32]($kante * $kante * 4))
    $w.Write([int32]0); $w.Write([int32]0); $w.Write([uint32]0); $w.Write([uint32]0)
    # Farbdaten, zeilenweise von unten nach oben
    for ($y = $kante - 1; $y -ge 0; $y--) {
        $w.Write($punkte, ($y * $kante * 4), ($kante * 4))
    }
    # Maske: je Zeile auf vier Byte aufgefüllt, überall null — die Durchsichtigkeit
    # steckt schon im Alphakanal der Farbdaten.
    $maskenbreite = [int](([Math]::Floor(($kante + 31) / 32)) * 4)
    $w.Write((New-Object byte[] ($maskenbreite * $kante)))
    $w.Flush()
    $block = $strom.ToArray()
    $w.Dispose(); $strom.Dispose()
    return ,$block
}

# Größer als 128 wird nicht abgelegt: ein 256er Bild wiegt allein 256 KB und
# Windows rechnet die 128 für die seltene Riesenansicht sauber hoch.
$kanten = @(16, 20, 24, 32, 48, 64, 128)
$bloecke = New-Object System.Collections.ArrayList
foreach ($kante in $kanten) {
    $bild = Zeichne-Symbol $kante
    [void]$bloecke.Add((Bild-In-Symbolblock $bild))
    $bild.Dispose()
}

$strom = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $strom
$w.Write([uint16]0)                      # reserviert
$w.Write([uint16]1)                      # Typ 1 = Symbol
$w.Write([uint16]$kanten.Count)
$versatz = 6 + 16 * $kanten.Count        # hinter dem Verzeichnis geht es los
for ($i = 0; $i -lt $kanten.Count; $i++) {
    $kante = $kanten[$i]
    $w.Write([byte]$kante)
    $w.Write([byte]$kante)
    $w.Write([byte]0)                    # Farben in der Palette: keine
    $w.Write([byte]0)                    # reserviert
    $w.Write([uint16]1)                  # Ebenen
    $w.Write([uint16]32)                 # Bits je Bildpunkt
    $w.Write([uint32]$bloecke[$i].Length)
    $w.Write([uint32]$versatz)
    $versatz += $bloecke[$i].Length
}
foreach ($b in $bloecke) { $w.Write([byte[]]$b) }
$w.Flush()
[System.IO.File]::WriteAllBytes($symbolDatei, $strom.ToArray())
$w.Dispose(); $strom.Dispose()
Write-Host "  Symbol:    $($kanten.Count) Größen, $([math]::Round((Get-Item $symbolDatei).Length / 1KB, 1)) KB"

# --- 4. Skript als Base64 in Häppchen ------------------------------------------
$roh    = [System.IO.File]::ReadAllText($skriptDatei, [System.Text.Encoding]::UTF8)
$base64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($roh))
$haeppchen = New-Object System.Collections.ArrayList
for ($i = 0; $i -lt $base64.Length; $i += 3000) {
    [void]$haeppchen.Add('"' + $base64.Substring($i, [Math]::Min(3000, $base64.Length - $i)) + '"')
}
Write-Host ("  Skript:    {0:N0} Zeichen, {1} Häppchen" -f $roh.Length, $haeppchen.Count)

# --- 5. C#-Hülle erzeugen -------------------------------------------------------
$smaPfad = [psobject].Assembly.Location
$quelle = @"
using System;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Management.Automation;
using System.Management.Automation.Runspaces;

// Angaben, die Windows in den Dateieigenschaften unter "Details" anzeigt.
// Sie ersetzen keine Signatur -- der Warnhinweis beim ersten Start bleibt --,
// aber sie sagen, wer die Datei gebaut hat und was sie ist.
[assembly: System.Reflection.AssemblyTitle("DocKit")]
[assembly: System.Reflection.AssemblyProduct("DocKit")]
[assembly: System.Reflection.AssemblyCompany("Tim Oldenburg")]
[assembly: System.Reflection.AssemblyCopyright("Tim Oldenburg")]
[assembly: System.Reflection.AssemblyDescription("Baukasten fuer Schriftgut: Textbausteine, Formularfelder und Vorlagen")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.0.0")]

// Huelle um DocKit.ps1. Startet das Skript in einer PowerShell-Sitzung
// im eigenen Prozess -- kein Konsolenfenster, kein zweiter Prozess.
static class DocKit_Start
{
    static readonly string[] Teile = new string[] {
$($haeppchen -join ",`r`n")
    };

    [STAThread]
    static void Main()
    {
        try
        {
            StringBuilder sb = new StringBuilder();
            foreach (string t in Teile) sb.Append(t);
            string skript = Encoding.UTF8.GetString(Convert.FromBase64String(sb.ToString()));
            string ordner = System.IO.Path.GetDirectoryName(Application.ExecutablePath);

            InitialSessionState start = InitialSessionState.CreateDefault();
            start.ApartmentState = ApartmentState.STA;
            start.ThreadOptions  = PSThreadOptions.UseCurrentThread;

            using (Runspace sitzung = RunspaceFactory.CreateRunspace(start))
            {
                sitzung.Open();
                sitzung.SessionStateProxy.SetVariable("DocKitBasis", ordner);

                using (PowerShell ps = PowerShell.Create())
                {
                    ps.Runspace = sitzung;
                    ps.AddScript(skript);
                    ps.Invoke();

                    if (ps.Streams.Error.Count > 0)
                    {
                        ErrorRecord e = ps.Streams.Error[0];
                        MessageBox.Show(
                            "Beim Ausfuehren ist ein Fehler aufgetreten:" + Environment.NewLine + Environment.NewLine
                            + e.ToString() + Environment.NewLine + Environment.NewLine
                            + e.InvocationInfo.PositionMessage,
                            "DocKit", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Beim Start ist ein Fehler aufgetreten:" + Environment.NewLine + Environment.NewLine + ex.Message,
                "DocKit", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
"@

$quellDatei = Join-Path $env:TEMP ('DocKit_Huelle_' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.cs')
[System.IO.File]::WriteAllText($quellDatei, $quelle, (New-Object System.Text.UTF8Encoding($false)))

# --- 6. Übersetzen --------------------------------------------------------------
$argumente = @(
    '/nologo'
    '/target:winexe'
    '/optimize+'
    '/codepage:65001'      # die C#-Quelle wird als UTF-8 geschrieben
    "/out:`"$zielExe`""
    "/reference:`"$smaPfad`""
    '/reference:System.dll'
    '/reference:System.Windows.Forms.dll'
    '/reference:System.Drawing.dll'
)
if (Test-Path -LiteralPath $symbolDatei) { $argumente += "/win32icon:`"$symbolDatei`"" }
$argumente += "`"$quellDatei`""

$ausgabe = & $csc @argumente 2>&1
$erfolg  = ($LASTEXITCODE -eq 0)
[System.IO.File]::Delete($quellDatei)

if (-not $erfolg) {
    Write-Host ''
    $ausgabe | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    throw 'Das Übersetzen ist fehlgeschlagen.'
}

$groesse = [math]::Round((Get-Item -LiteralPath $zielExe).Length / 1KB, 1)
Write-Host ''
Write-Host "  Fertig:    $zielExe  ($groesse KB)" -ForegroundColor Green
Write-Host '  Neben der Programmdatei muss nur der Ordner "Daten" liegen.'
Write-Host ''
