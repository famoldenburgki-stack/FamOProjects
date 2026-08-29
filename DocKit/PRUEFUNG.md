# Hinweise für die Codeprüfung

Dieses Dokument richtet sich an Prüferinnen und Prüfer, die das Werkzeug vor einem
Einsatz freigeben sollen. Es beantwortet die Fragen, die dabei üblicherweise zuerst
kommen — und sagt, wo im Quelltext die Antwort steht.

---

## 1. Kurzbeschreibung

DocKit ist ein Baukasten für Schriftgut: Textbausteine, Formularfelder und Vorlagen. Es liegt als Symbol im
Infobereich der Taskleiste, wartet auf eine Tastenkombination, zeigt eine Auswahl und
legt den gewählten Text in die Zwischenablage — anschließend wird `Strg+V` an das
Fenster gesendet, das vorher aktiv war.

Zusätzlich verwaltet es **Vorlagen**: Verweise auf vorhandene Dateien, etwa einen
Blanko-Briefkopf. Diese können kopiert und über Word mit einem Textbaustein gefüllt
werden. Eine **Kombination** verknüpft eine bestimmte Vorlage fest mit einem
bestimmten Baustein unter einem eigenen Namen — die Nachfrage, welcher Baustein
hinein soll, entfällt dann.

---

## 2. Was mitgeliefert wird

| Datei | Bedeutung |
|---|---|
| `DocKit.exe` | Die Programmdatei. Enthält das Skript als Base64. |
| `Programm\DocKit.ps1` | **Der eigentliche Quelltext.** Hier findet die Prüfung statt. |
| `Programm\Exe-bauen.ps1` | Erzeugt aus dem Skript die Programmdatei. Zeichnet dabei auch das Symbol neu. |
| `Programm\Selbstpruefung.ps1` | Prüft den Quelltext auf Fehlerbilder, die PowerShell klaglos hinnimmt. Läuft beim Bauen automatisch mit. |
| `Windows-Warnung aufheben.bat` | Entfernt die Herkunftsmarkierung heruntergeladener Dateien (`Unblock-File`). Keine erhöhten Rechte. |
| `Daten\*.tbd` | Textbausteindateien im JSON-Format, im Klartext lesbar. |
| `Anleitung.html` | Bedienungsanleitung für Anwender. |
| `README.md` | Technische Beschreibung für die Weiterarbeit. |

**Die `.exe` enthält keinen anderen Code als die `.ps1`.** Das lässt sich nachvollziehen,
indem `Programm\Exe-bauen.ps1` erneut ausgeführt und das Ergebnis verglichen wird.

---

## 3. Fremdbestandteile

**Keine.** Verwendet werden ausschließlich Bestandteile, die zu Windows gehören:

```
mscorlib · System · System.Windows.Forms · System.Drawing · System.Management.Automation
```

Übersetzt wird mit `csc.exe` aus dem .NET Framework, ebenfalls Teil von Windows.
Nachprüfbar mit:

```bash
powershell -NoProfile -Command "[Reflection.Assembly]::ReflectionOnlyLoadFrom('DocKit.exe').GetReferencedAssemblies() | Select-Object Name, Version"
```

Zur Laufzeit werden zusätzlich drei COM-Objekte von Windows angesprochen, alle nur
bei ausdrücklicher Handlung des Anwenders:

- `Word.Application` — um einen oder mehrere Bausteine in eine kopierte Vorlage zu schreiben, und
  um die erste Seite einer Word-Vorlage für die eingebaute Vorschau zu rendern (dabei stets
  unsichtbar, `Visible = $false`)
- `Excel.Application` — dasselbe für die Vorschau einer Excel-Vorlage
- `Shell.Application` — um den im Explorer geöffneten Ordner zu ermitteln

---

## 4. Sicherheitsrelevantes Verhalten

### Was das Programm tut

| Verhalten | Wo im Quelltext | Zweck |
|---|---|---|
| Systemweite Tastenkombination anmelden | `DocKit.Tastenwaechter`, Abschnitt 1 | Öffnet die Auswahl |
| Fokus an ein fremdes Fenster zurückgeben | `Windows.FokusZurueck`, Abschnitt 1 | Einfügen im Ausgangsfenster |
| `Strg+V` senden | `Fuege-Text-Ein`, Abschnitt 3 | Der eigentliche Einfügevorgang |
| Zwischenablage lesen | `Hole-Zwischenablage`, Abschnitt 3 | Nur für den Platzhalter `{zwischenablage}` |
| Zwischenablage schreiben | `Setze-Zwischenablage`, Abschnitt 4 | Text als RTF und als Klartext |
| Dateien lesen und schreiben | `Lies-Json` / `Schreib-Json`, Abschnitt 1 | Bausteindatei und Einstellungen |
| Word steuern | `Schreibe-Bausteine-In-Dokument`, Abschnitt 2 | Einen oder mehrere Bausteine in eine Vorlagenkopie schreiben |
| Explorer-Ordner erfragen | `Hole-Explorer-Ordner`, Abschnitt 2 | Zielordner für eine Vorlagenkopie |
| Programm starten | `Start-Process` an mehreren Stellen | Öffnet Anleitung, Ordner oder — auf Klick im Vorschaufenster — eine Vorlagendatei |
| Bausteine in eine fremde Datei schreiben | `Kopiere-In-Datei`, Abschnitt 2 | Weitergeben an eine andere Textbausteindatei; nur auf ausdrückliche Auswahl des Anwenders |
| Datei in `%TEMP%` anlegen | `Erzeuge-Weitergabe-Temp`, Abschnitt 2 | Der Baustein, der gerade gezogen oder in die Zwischenablage gelegt wird |
| Vorlage und verknüpfte Bausteine einer Kombination auflösen | `Pruefe-Kombination`, Abschnitt 2 | Nur eine Suche in den bereits geladenen Listen — kein zusätzlicher Dateizugriff |
| Vorlage unsichtbar öffnen und als Bild rendern | `Rendere-Wort-Vorschau` / `Rendere-Excel-Vorschau`, Abschnitt 2 | Eingebaute Vorschau, ausgelöst über einen eigenen Knopf »Vorschau« — nie automatisch beim bloßen Anklicken einer Zeile. Word/Excel wird nie sichtbar, die Ursprungsdatei nie verändert (nur lesend geöffnet) |
| Vorlage in TEMP kopieren und öffnen | `Zeige-Vorlage-Vorschau`, Abschnitt 2 | Rückfalloption im Vorschaufenster: „In eigenem Programm öffnen", nur auf ausdrücklichen Klick. Die Kopie ist schreibgeschützt (`ReadOnly`-Attribut), die Ursprungsdatei bleibt unangetastet. |
| Systemweiten Tastatur-Haken anmelden | `DocKit.Kuerzelwaechter`, Abschnitt 1 | Kürzel-Erkennung (siehe eigener Abschnitt unten) — **nur, wenn in den Einstellungen ausdrücklich eingeschaltet; standardmäßig aus** |

### Kürzel-Erkennung: die eine Ausnahme vom „kein Tastaturmitschnitt"

Seit Fassung 1.4 kann DocKit ein festgelegtes Kürzel — etwa `#AV` — erkennen, sobald es in
**irgendeinem** Programm getippt und mit Leertaste, Enter oder Tab abgeschlossen wird, und
setzt dafür sofort den zugehörigen Baustein ein. Technisch geht das nur über einen
systemweiten Tastatur-Haken (`SetWindowsHookEx` mit `WH_KEYBOARD_LL`) — dieselbe Technik,
die Programme wie PhraseExpress benutzen. Das widerspricht der bisherigen Aussage weiter
unten, „es gibt keinen Tastaturhaken" — deshalb hier ausführlich, statt die alte Aussage
einfach stehen zu lassen.

**Standardmäßig aus.** Der Haken wird nur installiert, wenn unter Einstellungen →
Kürzel-Erkennung ausdrücklich angehakt wird (`autotext_aktiv` in den Einstellungen, Standard
`false`). Ohne dieses Anhaken verhält sich DocKit exakt wie vorher — kein Haken, keine
Ausnahme von den übrigen Zusagen in diesem Abschnitt.

**Was der Haken sieht, und was er damit macht.** Jeder Tastendruck im System löst den
Haken kurz aus (das ist bei `WH_KEYBOARD_LL` technisch nicht vermeidbar — er bekommt jede
Taste, ganz gleich in welchem Programm). Verarbeitet wird davon nur, welches Zeichen die
Taste erzeugt; das kommt in einen Zwischenspeicher (`Kuerzelwaechter.puffer`, höchstens 40
Zeichen), der bei jedem Leerzeichen/Enter/Tab, jeder Rücktaste und jeder nicht als Zeichen
abgebildeten Taste (Pfeiltasten etc.) sofort verworfen wird. Geprüft wird ausschließlich, ob
der aktuelle Pufferinhalt einem der hinterlegten Kürzel entspricht — passt keines, ist der
Inhalt bereits vergessen, bevor die nächste Taste kommt. **Es wird nichts protokolliert,
in eine Datei geschrieben, über das Netzwerk gesendet oder sonst irgendwo dauerhaft
abgelegt.** Ebenfalls ignoriert: alles, was innerhalb von DocKit selbst getippt wird
(`ImEigenenFenster`), und alle künstlich erzeugten Tastendrücke — also die eigenen, beim
Ersetzen gesendeten Rücktasten und das anschließende Einfügen (`LLKHF_INJECTED`-Flag).

**Wohin es geschrieben wird, wenn ein Kürzel passt.** Erkannt wird das nur außerhalb des
Hakens selbst, in einem Zeitgeber, der die Fundliste alle 60 ms abholt (`Verarbeite-Autotext-Treffer`)
— der Haken muss sofort zurückkehren, sonst kann Windows ihn deaktivieren. Das Kürzel wird
dann per `SendKeys` aus dem Zielprogramm herausgelöscht (so viele Rücktasten wie Zeichen im
Kürzel) und der Baustein an derselben Stelle eingefügt — derselbe Weg wie beim Einfügen über
die Tastenkombination.

**Bekanntes Risiko, nicht versteckt: Virenschutz/EDR.** Ein systemweiter Tastatur-Haken ist
rein technisch dieselbe Art Baustein, aus der auch echte Keylogger bestehen — manche
Sicherheitsprogramme stufen `SetWindowsHookEx`/`WH_KEYBOARD_LL` deshalb pauschal als
verdächtig ein, unabhängig davon, was der Code damit tatsächlich anstellt. Auf einem streng
abgesicherten Arbeitsplatz kann das dazu führen, dass DocKit gemeldet, blockiert oder in
Quarantäne verschoben wird, sobald die Kürzel-Erkennung eingeschaltet wird. Deshalb: aus
genau diesem Grund standardmäßig aus, und bei Auffälligkeiten einfach wieder ausschalten —
der Rest von DocKit funktioniert unverändert weiter.

### Was das Programm sonst nicht tut

- **Keine Netzverbindung.** Es gibt keinen Aufruf von `Invoke-WebRequest`,
  `Net.WebClient`, `Net.Sockets` oder vergleichbarem. Nachprüfbar durch Suche.
- **Kein Schreiben in die Registry.**
- **Kein Autostart**, kein Dienst, keine geplante Aufgabe.
- **Keine erhöhten Rechte.** Es gibt kein Manifest und keinen `runas`-Aufruf.
- **Keine Aufzeichnung von Tastatureingaben.** Der Tastatur-Haken der Kürzel-Erkennung
  (siehe oben) ist die eine, bewusste und abschaltbare Ausnahme — er hält nichts fest,
  sondern vergisst jede Eingabe sofort wieder, sobald geprüft ist, ob sie zu einem der
  hinterlegten Kürzel passt. Ohne eingeschaltete Kürzel-Erkennung gilt weiterhin: Die
  Tastenkombination zum Öffnen der Schnellwahl wird über `RegisterHotKey` angemeldet: das
  Betriebssystem meldet nur diese eine Kombination zurück, kein Haken ist dafür nötig.
- **Keine Zwischenablageüberwachung.** Gelesen wird nur, wenn ein Baustein den
  Platzhalter `{zwischenablage}` enthält.

Bis auf `SetWindowsHookEx` (siehe Kürzel-Erkennung oben) lassen sich diese Aussagen mit
einer Textsuche über `Programm\DocKit.ps1` belegen — die übrigen genannten Begriffe kommen
dort nicht vor.

---

## 5. Wo Daten liegen

| Inhalt | Ort | Anmerkung |
|---|---|---|
| Bausteine und Vorlagen | frei gewählte `.tbd`-Datei | JSON im Klartext, auch auf Netzlaufwerk |
| Einstellungen | `%APPDATA%\DocKit\einstellungen.json` | je Anmeldename getrennt |
| Sicherungskopie | `<Bausteindatei>.sicherung` | jeweils der Stand vor dem letzten Speichern |
| Bausteine zum Weitergeben | selbst gewählter Ort, Endung `.tbx` | derselbe JSON-Aufbau, zusätzlich Anmeldename und Zeitpunkt des Erzeugers |
| dieselben beim Ziehen | `%TEMP%\DocKit-Weitergabe\…` | entsteht erst beim Ziehen; Windows holt sie von dort |
| Programm | beliebiger Ordner | darf schreibgeschützt sein |

Beim Weitergeben eines Bausteins wird der **Windows-Anmeldename** des Absenders in
die `.tbx`-Datei geschrieben, damit der Empfänger sieht, woher sie stammt. Wer das
nicht will, kann die Datei vor dem Versand mit einem Editor öffnen und den Eintrag
`von` leeren — sie bleibt dann lesbar.

Es werden **keine personenbezogenen Daten** eigenständig erhoben. In den Text
eingesetzt werden lediglich der Windows-Anmeldename (`{benutzer}`) und der
Rechnername (`{computer}`), und auch das nur, wenn ein Baustein diese Platzhalter
enthält.

---

## 6. Aufbau des Quelltextes

Die Datei ist in zehn nummerierte Abschnitte gegliedert; die Übersicht steht im Kopf
der Datei. Grobe Orientierung:

```
 1. Grundlagen ............ Pfade, Windows-Funktionen (P/Invoke), JSON
 2. Textbausteindateien ... Öffnen, Anlegen, Wechseln; Vorlagen benutzen
 3. Textmaschine .......... Platzhalter, Zwischenablage, Einfügen
 4. Formatierter Text ..... RTF: Schrift, Zeilenabstand, Ersetzung im Dokument
 5. Oberfläche ............ gemeinsame Bausteine für alle Fenster
 6. Assistent ............. Fenster zum Ausfüllen der Felder
 7. Schnellwahl ........... das Fenster hinter der Tastenkombination
 8. Verwaltung ............ Bausteine und Vorlagen bearbeiten
 9. Einstellungen ......... Tastenkombination, Standardschrift, Verhalten
10. Start ................. Symbol im Infobereich, Hauptschleife
```

Sämtliche Bezeichner, Kommentare und Meldungen sind auf Deutsch.

---

## 7. Zwei Eigenheiten, die Absicht sind

Beides sieht auf den ersten Blick nach einem Fehler aus und ist keiner.

### `$global:` statt `$script:`

Ereignisbehandlungen werden mit `.GetNewClosure()` erzeugt, damit sie die
Steuerelemente ihres Fensters behalten. Eine Closure bekommt dabei einen **eigenen
Modulbereich**. Darin zeigt `$script:` nicht mehr auf den Skriptbereich, sondern ins
Leere; `$global:` dagegen weiterhin auf denselben Wert. Ein Umstellen auf `$script:`
würde das Programm still zerstören — die Fenster blieben leer.

### Guillemets `»…«` in Meldungstexten

PowerShell behandelt das typografische `„` (U+201E) als vollwertiges
Zeichenketten-Trennzeichen. In `"Den Baustein „$name" löschen?"` endet die
Zeichenkette bereits am `„`; der Rest der Zeile wird zu Text. **Der Code bleibt
syntaktisch gültig und bedeutet etwas anderes** — eine Syntaxprüfung meldet nichts.

Dieser Fehler ist in der Entwicklung einmal aufgetreten und hat rund 90 Zeilen
lautlos entwertet. Deshalb stehen in doppelt zitierten Zeichenketten durchgängig
Guillemets. In einfach zitierten Zeichenketten (`'…'`) sind `„…"` unbedenklich.

---

## 8. Selbstprüfung des Quelltextes

Drei Abfragen über den Syntaxbaum fangen die Fehlerbilder ab, die eine reine
Syntaxprüfung übersieht. Sie liegen als Skript unter `Programm\Selbstpruefung.ps1`
und lassen sich einzeln nachvollziehen:

```powershell
$ast = [System.Management.Automation.Language.Parser]::ParseFile($pfad, [ref]$null, [ref]$null)

# 1. Zeichenketten, die sich über mehrere Zeilen ziehen — Anzeichen für ein
#    vorzeitig beendetes Anführungszeichen
$ast.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and
    $n.Extent.StartLineNumber -ne $n.Extent.EndLineNumber }, $true)

# 2. Verschachtelte GetNewClosure — die innere erbt die Variablen der äußeren nicht.
#    Entscheidend ist die Zahl der umgebenden Scriptblöcke: schon EINER bedeutet,
#    dass der Aufruf in einer anderen Closure steckt. Funktionsrümpfe zählen nicht
#    mit, die sind ein ScriptBlockAst und kein ScriptBlockExpressionAst.
foreach ($c in $ast.FindAll({ param($n)
        $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and
        $n.Member.Value -eq 'GetNewClosure' }, $true)) {
    $tiefe = 0; $eltern = $c.Parent
    while ($eltern) {
        if ($eltern -is [System.Management.Automation.Language.ScriptBlockExpressionAst]) { $tiefe++ }
        $eltern = $eltern.Parent
    }
    if ($tiefe -ge 1) { "Verschachtelt in Zeile $($c.Extent.StartLineNumber)" }
}

# 3. Funktionen, die nirgends aufgerufen werden — meist Reste eines Umbaus
$erklaert = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name }
$gerufen  = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() }
$erklaert | Where-Object { $gerufen -notcontains $_ }
```

Alle drei liefern im aktuellen Stand keine Beanstandung.

**Anmerkung zur zweiten Abfrage.** Sie stand hier zunächst in einer Fassung, die
nur *alle* `GetNewClosure`-Aufrufe auflistete, und in einer zweiten, die zwei
umgebende Scriptblock-Ebenen verlangte. Beide meldeten zuverlässig „keine
Beanstandung" — und übersahen dabei vier echte Fälle. Eine Prüfabfrage ist erst
dann eine Aussage, wenn sie an einem bekannten Fehler angeschlagen hat.

---

## 9. Grenzen

- **Nicht signiert.** Die Programmdatei trägt keine Authenticode-Signatur. Windows meldet
  deshalb beim ersten Start „Unbekannter Herausgeber"; über *Weitere Informationen →
  Trotzdem ausführen* geht es weiter. In den Dateieigenschaften unter *Details* stehen
  Hersteller (`Tim Oldenburg`), Produkt und Version — diese Angaben stammen aus den
  Assembly-Attributen der Programmdatei und werden von Windows **nicht geprüft**; sie
  ersetzen keine Signatur. Wo Anwendungen nur signiert starten dürfen, muss die Datei
  signiert oder das Skript über die mitgelieferte `.bat` gestartet werden.
- **Herkunftsmarkierung.** Dateien aus einer heruntergeladenen ZIP tragen einen
  `Zone.Identifier`-Datenstrom, der die Warnung auslöst. `Windows-Warnung aufheben.bat`
  entfernt ihn mit `Unblock-File` von den Dateien daneben — ohne erhöhte Rechte und ohne
  Eingriff in den Rechner.
- **Word wird benötigt**, aber nur für das Schreiben eines Bausteins in eine
  Vorlagenkopie. Fehlt Word, bleiben alle übrigen Funktionen nutzbar; das Programm
  sagt es und legt die Kopie trotzdem an.
- **Kein Mehrbenutzerschutz auf einer gemeinsamen Datei.** Bearbeiten zwei Personen
  dieselbe `.tbd` gleichzeitig, gewinnt der letzte Speichervorgang. Für gemeinsame
  Dateien empfiehlt sich Schreibschutz für alle außer den Pflegenden.
