# DocKit

Baukasten für Schriftgut: Textbausteine, Formularfelder und Vorlagen. Eine systemweite Tastenkombination öffnet eine
Schnellwahl; der gewählte Baustein wird — nach optionaler Rückfrage über Auswahl-, Datums- und
Ja/Nein-Felder — an der Cursorstelle des zuvor aktiven Programms eingefügt.

**Reine Windows-Bordmittel.** PowerShell 5.1 und WinForms, beides in jedem Windows enthalten.
Keine Installation, kein Registry-Eintrag, kein Autostart, keine Netzwerkverbindung, keine
Administratorrechte. Der Ordner ist vollständig portabel: auf einen USB-Stick kopieren und dort
starten, alle Daten liegen daneben in `Daten`.

Für die Bedienung: **[Anleitung.html](Anleitung.html)** — im Browser öffnen, geschrieben für
Anwender ohne IT-Hintergrund. Für einen ersten Überblick vor dem Ausprobieren:
**[Erste Schritte.html](Erste%20Schritte.html)**.

Dies ist ein privates Hobbyprojekt, kein offizielles Produkt einer Behörde. Es entstand mit
Unterstützung von KI (Claude) — offengelegt, weil es zur ehrlichen Einordnung dazugehört, nicht
weil es den Quelltext weniger vertrauenswürdig machen würde: Er lässt sich vollständig lesen,
siehe [PRUEFUNG.md](PRUEFUNG.md).

---

## Ausprobieren (von GitHub heruntergeladen)

1. Oben auf **Code → Download ZIP**, oder das ganze Repository klonen.
2. Die ZIP entpacken und in den Ordner **`DocKit`** wechseln.
3. Windows markiert Dateien aus einer heruntergeladenen ZIP als „aus dem Internet" — das löst
   beim ersten Start die Meldung *„Der Computer wurde durch Windows geschützt"* aus. Das ist keine
   Fehlfunktion, nur eine Vorsichtsmaßnahme von Windows gegen unbekannte Herausgeber. Zwei Wege,
   damit umzugehen:
   - **Schnell:** Bei der Meldung auf *Weitere Informationen → Trotzdem ausführen* klicken.
   - **Für alle Dateien auf einmal:** Doppelklick auf **`Windows-Warnung aufheben.bat`**, bevor
     überhaupt gestartet wird — entfernt die Markierung von allen Dateien im Ordner
     (`Unblock-File`, keine erhöhten Rechte, ändert nichts am Rechner selbst).
4. Doppelklick auf **`DocKit starten.bat`**.
5. Läuft `DocKit.exe` an diesem Arbeitsplatz gar nicht (Richtlinie blockiert unsignierte
   Programme)? Dann **`Falls die Programmdatei blockiert ist.bat`** — startet dasselbe über
   PowerShell statt über die `.exe`.

Beim allerersten Start fragt ein Willkommensfenster nach einer neuen oder vorhandenen
Textbausteindatei. „Neu anlegen" füllt sie mit ein paar erfundenen Beispielen — echte Daten
kommen nirgends mit.

---

## Start (schon heruntergeladen)

Doppelklick auf **`DocKit starten.bat`**. Das Programm legt sich als Symbol in den
Infobereich der Taskleiste. **`Strg+Alt+T`** öffnet die Schnellwahl.

Wenn nichts passiert: **`Hilfe bei Problemen.bat`** starten — gleicher Ablauf, aber mit sichtbarem
Fenster, in dem Fehlermeldungen stehen bleiben.

```
DocKit/
├─ DocKit starten.bat                       ← Doppelklick
├─ Falls die Programmdatei blockiert ist.bat  ← Ausweichweg ohne die .exe
├─ Hilfe bei Problemen.bat                  ← nur im Fehlerfall
├─ Windows-Warnung aufheben.bat             ← nur bei "Unbekannter Herausgeber"
├─ Anleitung.html                           ← Bedienungsanleitung
├─ Erste Schritte.html                      ← kurzer Überblick
├─ Programm/
│   └─ DocKit.ps1                    ← das gesamte Programm, eine Datei
└─ Daten/                                   ← entsteht beim ersten Start
    ├─ bausteine.json                       ← die Textbausteine
    ├─ bausteine.json.sicherung             ← Stand vor dem letzten Speichern
    └─ einstellungen.json                   ← Tastenkombination und Verhalten
```

---

## Wie das Einfügen funktioniert

Der heikle Teil ist nicht der Text, sondern der Fokus. Ablauf:

```
Strg+Alt+T
   └─ RegisterHotKey meldet sich  →  GetForegroundWindow merkt sich das Zielfenster
        └─ Schnellwahl öffnet sich (unser Prozess ist jetzt vorn)
             └─ Baustein gewählt → ggf. Assistent → fertiger Text
                  └─ Text in die Zwischenablage
                  └─ AttachThreadInput + SetForegroundWindow holen das Zielfenster zurück
                  └─ SendKeys Strg+V
```

`AttachThreadInput` ist nötig, weil Windows einem Prozess nicht erlaubt, einem fremden Fenster
einfach den Fokus zuzuschieben. Da unser Fenster im Moment des Einfügens selbst noch den Fokus
hat, dürfen wir ihn zurückgeben.

Klappt das Zurückholen nicht — etwa weil das Zielprogramm mit höheren Rechten läuft —, bleibt der
Text in der Zwischenablage und `Strg+V` erledigt den Rest. Der Fall ist also unschön, aber nie
verlustbehaftet.

---

## Aufbau von `bausteine.json`

Eine flache Liste; Kategorien entstehen aus dem Feld `kategorie`.

```json
{
  "kategorie": "Schreiben",
  "name": "Zeugenladung",
  "kuerzel": "ladung",
  "beschreibung": "Ladung eines Zeugen zu einem Termin",
  "text": "{Anrede} {Nachname},\r\n\r\n… am {Termin} …\r\n\r\n{Entschaedigung}",
  "felder": [
    { "name": "Anrede", "typ": "auswahl",
      "optionen": [ { "anzeige": "Herr", "wert": "Sehr geehrter Herr" } ] },
    { "name": "Termin", "typ": "datum", "standard": "+7" },
    { "name": "Entschaedigung", "typ": "schalter", "standard": "ja",
      "wenn_ja": "Ihre Auslagen werden auf Antrag erstattet.", "wenn_nein": "" },
    { "name": "Fristdatum", "typ": "datum", "standard": "+14",
      "zeigen_wenn_feld": "Fristsatz", "zeigen_wenn_wert": "bis zu einem Datum" }
  ]
}
```

**Formatierung.** Maßgeblich ist das Feld `rtf`; `text` ist die reine Fassung zum Suchen und als
Rückfallebene. Bausteine ohne `rtf` werden beim Laden automatisch umgesetzt — Standard ist Arial 12
mit 1,5 Zeilen, einstellbar über `standard_schriftart`, `standard_groesse`, `standard_zeilenabstand`.

Gerechnet wird **nie an der RTF-Zeichenkette**, sondern immer in einem unsichtbaren
`RichTextBox` (`Neues-Rechenfeld`). Das erspart das Zerlegen von RTF-Befehlen und hat einen
angenehmen Nebeneffekt: Weil `Ersetze-Platzhalter-Rtf` über `Select`/`SelectedText` auf der
Textebene arbeitet, **erbt der eingesetzte Wert die Formatierung des Platzhalters**. Ein fett
gesetztes `{Nachname}` liefert einen fetten Namen.

In die Zwischenablage gehen über ein `DataObject` beide Fassungen gleichzeitig — `Rtf` und
`UnicodeText`. Jedes Zielprogramm nimmt sich, was es versteht; die Einstellung `nur_reiner_text`
unterdrückt die formatierte Fassung.

Zeilen- und Absatzabstand laufen über `EM_SETPARAFORMAT` (Klasse `DocKit.Absatz`), weil
WinForms dafür nichts anbietet. **Nur schreibend:** `EM_GETPARAFORMAT` meldete in der Erprobung
durchgängig „einfacher Abstand" zurück, auch unmittelbar nach dem Setzen. Maßgeblich ist deshalb
der RTF-Inhalt — `\sl240` = 1,0 Zeilen, `\sl360` = 1,5, `\sl480` = 2,0. Blocksatz kann das
Steuerelement nicht.

**Feldarten:** `text`, `mehrzeilig`, `auswahl`, `datum`, `uhrzeit`, `zahl`, `schalter`.

**Auswahllisten** trennen Anzeige und Wert. Damit genügt ein einziges Feld für die komplette
Anredezeile, statt Anrede und Endung getrennt abzufragen.

**Ja/Nein-Felder** (`schalter`) blenden ganze Absätze ein oder aus. Fällt ein Absatz weg, räumt
die Textmaschine die entstehende Leerzeile mit weg.

**Vorbelegung bei `datum`:** `heute`, `morgen`, `gestern`, `+7`, `-3` oder ein festes Datum.

**Abhängige Felder** über `zeigen_wenn_feld` und `zeigen_wenn_wert`: Das Feld erscheint im
Assistenten nur, wenn das genannte andere Feld auf dem genannten Wert steht. Verglichen wird gegen
die **Anzeige** einer Auswahlliste (nicht gegen den eingefügten Wert) beziehungsweise gegen `ja`/`nein`
bei einem Schalter — das ist die Beschriftung, die der Anwender vor sich sieht.

Die Sichtbarkeit wird in bis zu sechs Runden gerechnet, damit Ketten aufgehen: A blendet B ein,
B blendet C ein. Ist der Auslöser selbst ausgeblendet, verschwindet das abhängige Feld mit. Ein
ausgeblendetes Feld liefert immer den leeren Wert — sonst stünde im Text etwas, das der Anwender
nie zu Gesicht bekommen hat.

Jedes Feld sitzt im Assistenten in einer eigenen Panel-Zeile. Beim Ein- und Ausblenden werden die
sichtbaren Zeilen neu gestapelt; deshalb gibt es keine Löcher im Formular.

**Immer verfügbare Platzhalter,** ohne eigenes Feld: `{heute}`, `{uhrzeit}`, `{jahr}`, `{monat}`,
`{tag}`, `{benutzer}`, `{computer}`, `{zwischenablage}`. (`{morgen}`, `{gestern}`, `{jetzt}` und
`{wochentag}` gab es bis Fassung 1.0 auch — sie wurden als überflüssig entfernt. `morgen` und`r
`gestern` bleiben als **Vorbelegung eines Datumsfelds** erhalten, das ist etwas anderes.)

Die Ersetzung läuft in bis zu fünf Durchgängen, damit der Text eines Ja/Nein-Feldes selbst wieder
Platzhalter enthalten darf (`Rückmeldung bis zum {Fristdatum}.`). Unbekannte Platzhalter bleiben
sichtbar stehen — im Assistenten rot markiert. Lieber eine sichtbare Klammer als ein stillschweigend
verschwundener Satzteil.

## Bausteine weitergeben: die `.tbx`-Datei

Damit ein Baustein den Weg zu einem Kollegen findet, ohne dass beide dieselbe Datei benutzen, gibt
es ein zweites Dateiformat. Es hat denselben Aufbau wie eine `.tbd`, nur mit zwei zusätzlichen
Angaben und der Endung `.tbx`:

```json
{
  "version": 1,
  "art": "weitergabe",
  "erzeugt": "2026-08-19 17:47:49",
  "von": "timbe",
  "bausteine": [ … ]
}
```

Weil beide Formate den Eintrag `bausteine` tragen, liest `Lies-Weitergabe` auch eine komplette
`.tbd` — wer seine ganze Sammlung schickt, dessen Bausteine lassen sich einzeln herauspicken.

**Beim Übernehmen bekommt jeder Baustein eine neue Kennung.** Die des Absenders gilt in dessen
Datei; zwei Bausteine mit derselben Kennung wären in einer Datei nicht mehr zu trennen, und das
Löschen träfe den falschen. Aus demselben Grund arbeitet `Kopiere-In-Datei` auf Duplikaten
(`Kopiere-Baustein`) — sonst änderte das Weitergeben Kennung und Namen des Stücks, das hier noch
in Gebrauch ist.

**Beim Ziehen trägt ein Baustein zwei Formate gleichzeitig.** Das `DataObject` enthält sowohl
`DocKitBaustein` (das hauseigene Format, für das Verschieben in eine andere Kategorie) als auch
eine `FileDrop`-Liste mit einer frisch in `%TEMP%` geschriebenen `.tbx`. Windows sucht sich aus,
was am Ziel gebraucht wird: innerhalb der Liste das eine, im Explorer oder in einem Outlook-Fenster
das andere. Deshalb wird mit `Move -bor Copy` gezogen — nur `Move` würde den Explorer ablehnen
lassen.


## Vorlagen ansehen: eingebettete Vorschau statt fremdem Fenster

Ein eigener Knopf „Vorschau" — in der Übersicht wie in der Vorlagenverwaltung — öffnet ein eigenes
DocKit-Fenster mit einer Vorschau, ohne dass Word, Excel oder ein anderes Programm sichtbar
aufgeht. **Bewusst kein automatisches Öffnen beim bloßen Anklicken einer Zeile** — das saß in einer
früheren Fassung so und wurde von Tim ausdrücklich verworfen: Ein Klick soll erst einmal nur
auswählen. In der Vorlagenverwaltung ist der Knopf immer da; in der Übersicht ist er nur aktiv,
solange die Auswahl gerade eine Vorlage ist (`$liste.Add_SelectedIndexChanged`). `Rendere-Wort-Vorschau`
öffnet die Datei unsichtbar per COM (`Visible = $false`), holt die
erste Seite über `Document.Windows(1).Panes(1).Pages(1).EnhMetaFileBits` als Vektorgrafik (EMF) und
schließt Word sofort wieder — nichts davon ist je auf dem Bildschirm zu sehen.
`Rendere-Excel-Vorschau` macht dasselbe sinngemäß für Tabellen (`UsedRange.CopyPicture` über die
Zwischenablage, deren vorheriger Inhalt danach wiederhergestellt wird). Bilddateien werden direkt
geladen, Textdateien direkt angezeigt. Für alles andere — oder wenn das Rendern fehlschlägt — bleibt
im Vorschaufenster ein Knopf „In eigenem Programm öffnen", der auf die alte, sichere Art zurückfällt:
eine schreibgeschützte Kopie in `%TEMP%\DocKit-Vorschau\<Kennung>\`, geöffnet mit `Start-Process`.

**Warum EMF und nicht ein Bitmap-Thumbnail?** Ein Enhanced Metafile speichert Zeichenbefehle statt
Pixel — die `PictureBox` (Modus `Zoom`) skaliert es beim Vergrößern des Fensters verlustfrei mit,
statt zu verpixeln.

**Word/Excel bekommen dabei nie ein sichtbares Fenster, aber sie laufen als eigener Prozess.**
Schlägt das Öffnen oder Rendern fehl, sorgt ein `try/catch/finally` mit `Quit()` in beiden Zweigen
dafür, dass kein unsichtbarer `WINWORD.EXE`/`EXCEL.EXE`-Prozess hängen bleibt — das wurde beim Bau
tatsächlich reproduziert (eine nicht existierende Datei ließ Word ohne das `finally` offen) und ist
seither Teil der Tests.

**Frühere Fassung: externes Programm auf einer schreibgeschützten Kopie.** Das öffnete beim Klick
spürbar ein fremdes Fenster im Hintergrund — genau das sollte die eingebettete Vorschau vermeiden.
Die Kopier-und-schreibschützen-Logik von damals lebt als bewusster Rückfalloption weiter, jetzt aber
nur noch auf ausdrücklichen Klick, nicht mehr automatisch.

## Kombinationen: Vorlage mit mehreren Bausteinen, jeder mit eigenem Ankerpunkt

Eine Kombination bündelt eine Vorlage mit einem oder mehreren Bausteinen unter einem eigenen Namen
— etwa „Anschreiben mit Anlage" für die Vorlage „Briefkopf" mit den Bausteinen „Anrede" (an einer
Marke im Text) und „Anlagenvermerk" (ans Ende angehängt). Beim Benutzen entfällt dann jede
Nachfrage: jeder verknüpfte Baustein landet automatisch an seiner eigenen, vorher festgelegten
Stelle.

```json
{
  "id": "…",
  "name": "Anschreiben mit Anlage",
  "kategorie": "Schreiben",
  "beschreibung": "",
  "vorlage_id": "…",
  "bausteine": [
    { "id": "…", "baustein_id": "…", "einfuegen_art": "marke", "einfuegen_marke": "{Anrede}" },
    { "id": "…", "baustein_id": "…", "einfuegen_art": "ende", "einfuegen_marke": "" }
  ],
  "erstellt_von": "timbe", "erstellt_am": "…",
  "geaendert_von": "timbe", "geaendert_am": "…"
}
```

**Der Ankerpunkt sitzt jetzt am einzelnen Baustein-Eintrag, nicht mehr an der Vorlage.** Fassung 1.1
kannte nur einen Baustein je Kombination und benutzte dafür die Einfügestelle der Vorlage
(`einfuegen_art`/`einfuegen_marke`). Weil mehrere Bausteine unmöglich alle an derselben einen Stelle
landen können, trägt jetzt jeder Eintrag in `bausteine` seinen eigenen Ankerpunkt; die Einfügestelle
der Vorlage selbst spielt für eine Kombination keine Rolle mehr. `Vervollstaendige-Kombination`
migriert eine alte, einzeln verknüpfte Kombination beim ersten Laden automatisch in einen
Ein-Eintrag-Array (Ankerpunkt: Marke `{Textbaustein}`, der bisherige Standard).

**Referenziert wird über die Kennung, nicht über den Namen** — sowohl bei der Vorlage als auch bei
jedem einzelnen Baustein-Eintrag. Werden Vorlage oder Baustein später umbenannt, bleibt die
Kombination gültig. Verschwindet die Vorlage, ein verknüpfter Baustein, oder ist die Liste leer,
meldet `Pruefe-Kombination` das mit einer verständlichen Meldung, statt stillschweigend abzubrechen
oder Text an die falsche Stelle zu schreiben.

**`Schreibe-Baustein-In-Dokument` wurde zu `Schreibe-Bausteine-In-Dokument` (Mehrzahl).** Word bleibt
für alle Einträge einer Kombination einmal geöffnet, statt je Baustein neu zu starten — jeder Eintrag
bekommt vor seinem Einfügen eine frisch belegte Zwischenablage, dann wird einmal gespeichert.
Findet sich für einen von mehreren Einträgen keine Stelle, werden die übrigen trotzdem geschrieben
und nur der eine fehlende gemeldet — nicht alles verworfen. Die Rückgabe ist seither ein Objekt
(`Fehler`, `Offen`) statt eines reinen Meldungstexts: `Offen` sagt dem Aufrufer, ob die Kopie durch
„danach öffnen" schon sichtbar in Word steht, damit sie nicht ein zweites Mal geöffnet wird.

**Eine Kombination ist weiterhin ein dünner Wrapper um die vorhandene Vorlagen-Maschinerie.**
`Benutze-Vorlage`, `Fuelle-Vorlagenkopie` und `Ziehe-Vorlage-Heraus` haben dafür einen zusätzlichen,
optionalen Parameter `-Eintraege` bekommen (eine Liste aus Baustein und Ankerpunkt) — steht er fest,
entfällt jede Nachfrage, und jeder Baustein landet an seiner eigenen Stelle. `-VorschlagName` (der
vorgeschlagene Dateiname folgt dem Namen der Kombination, nicht dem der zugrunde liegenden Vorlage)
gibt es weiterhin. `Benutze-Kombination` und `Ziehe-Kombination-Heraus` lösen die Kombination über
`Pruefe-Kombination` auf und reichen `-Eintraege` weiter — die eigentliche Kopier- und
Einfügearbeit bleibt an einer Stelle.

**Der Kombinationseditor zeigt die verknüpften Bausteine als eigene Liste** (Neu/Bearbeiten/Entfernen)
statt einer einzelnen Klappliste; jeder Eintrag öffnet einen eigenen kleinen Dialog
(`Zeige-Kombinationsbaustein-Editor`) für Baustein und Ankerpunkt — dieselbe Marke/Textmarke/Ende-Wahl
wie im Vorlageneditor, nur ohne „nur kopieren", da ein verknüpfter Baustein immer irgendwo landen
soll. Bearbeitet wird auf einer Arbeitskopie der Liste; erst „Übernehmen" schreibt sie zurück.

**In der Übersicht ist eine Kombination weiterhin ein eigener Eintragstyp** (`Art = 'kombination'`),
mit eigenem Reiter, eigenem Symbol (violettes „K") und eigener Farbe. Die Rechtsklick-Logik für
Kategorien (`$benenneKategorie`, `$loeseKategorieAuf`) war zuvor auf ein `[bool] $IstVorlage`
zugeschnitten; sie unterscheidet über ein `[string] $ArtKat` zwischen allen drei Listen.

---

## Hinweise für die Weiterarbeit am Code

Zwei Fallstricke, die beim Bau Zeit gekostet haben und beim Ändern wieder auftreten können:

**`.GetNewClosure()` und `$Script:` vertragen sich nicht.** Ereignisbehandlungen brauchen
`GetNewClosure`, um die lokalen Steuerelement-Variablen festzuhalten. Der dabei entstehende
Modul-Gültigkeitsbereich hat aber seinen *eigenen* `$Script:`-Bereich — geteilte Zustände sind
deshalb durchgängig `$global:`. Wird das vermischt, sind Listen plötzlich leer, ohne dass ein
Fehler erscheint.

**`return $liste` entrollt ArrayLists.** PowerShell macht aus einer zurückgegebenen `ArrayList`
ein Array fester Größe; späteres `.Add()` scheitert dann mit „Die Liste hatte eine feste Größe".
Deshalb überall `return , $liste`.

**Abstände werden gemessen, nicht geraten.** `Setze-Unter` stapelt Steuerelemente anhand von
`PreferredHeight`. Feste Pixelabstände sehen auf dem Entwicklungsrechner gut aus und legen die
Beschriftung auf einem Rechner mit größerer Windows-Schrift über das Eingabefeld.

## Lizenzen

Keine. Das Werkzeug benutzt ausschließlich Bestandteile, die zu Windows gehören:
`mscorlib`, `System`, `System.Windows.Forms`, `System.Drawing` und
`System.Management.Automation` — alle von Microsoft, alle im Betriebssystem enthalten. Übersetzt
wird mit dem `csc.exe` des .NET Framework, das ebenfalls Teil von Windows ist. Keine
Fremdbibliothek, kein Paketmanager, keine Beschaffung, keine Registrierung. Auch die verwendeten
Schriften — Segoe UI und Arial — liegen jedem Windows bei.

Nachprüfbar über die Verweise der Programmdatei:

```bash
powershell -NoProfile -Command "[Reflection.Assembly]::ReflectionOnlyLoadFrom('DocKit.exe').GetReferencedAssemblies() | Select-Object Name, Version"
```

## Wo was liegt

| | |
|---|---|
| **Textbausteindatei** (`.tbd`) | frei wählbar — vom Anwender beim ersten Start bestimmt |
| **Einstellungen** | `%APPDATA%\DocKit\einstellungen.json`, je Anmeldename |
| **Programm** | `DocKit.exe`, beliebiger Ordner, darf schreibgeschützt sein |

Die Trennung ist Absicht: Auf einem Behördenlaufwerk ist der Programmordner meist schreibgeschützt,
und jeder Anmeldename braucht eigene Einstellungen. Deshalb liegen dort nur die Merkposten —
Tastenkombination, Standardschrift, zuletzt geöffnete Dateien — während die Bausteine in einer
Datei stehen, die auch gemeinsam auf einem Laufwerk liegen kann.

Beim Start wird der Reihe nach gesucht: zuletzt benutzte Datei → `Daten\bausteine.json` neben dem
Programm (Bestand aus früheren Fassungen, wird stillschweigend übernommen) → Willkommensfenster.
Schlägt das Öffnen fehl, bleibt die bisherige Datei stehen; das Programm startet nie mit stillem
Leerzustand.

Das Sichern schreibt eine `.sicherung` daneben — schlägt das fehl, etwa auf einem schreibgeschützten
Laufwerk, wird trotzdem gespeichert.

## Die Programmdatei

`DocKit.exe` ist eine einzelne Datei, gebaut mit dem C#-Compiler, den Windows selbst
mitbringt (`csc.exe` aus dem .NET Framework) — kein Zusatzwerkzeug, kein Download, keine
Installation. Das Skript steckt als Base64 in der Programmdatei und läuft beim Start in einer
PowerShell-Sitzung **im selben Prozess**: ein Prozess, kein Konsolenfenster.

Neben der `.exe` muss nur der Ordner `Daten` liegen.

```bash
powershell -ExecutionPolicy Bypass -File "Programm\Exe-bauen.ps1"
```

**Nach jeder Änderung an `DocKit.ps1` muss die `.exe` neu gebaut werden** — sonst läuft
weiter der alte, einkompilierte Stand. Der Bauvorgang lässt vorher `Selbstpruefung.ps1` laufen,
zeichnet das Symbol neu und bricht ab, wenn etwas beanstandet wird.

Damit das Skript beide Startarten übersteht, wird der Programmordner nicht mehr blind aus
`$PSScriptRoot` gelesen: Beim Start aus der `.exe` ist der leer, dann reicht die C#-Hülle den
Ordner über `$global:DocKitBasis` herein. Die `.bat` bleibt als Rückfallebene bestehen,
falls eine unsignierte `.exe` an einem Arbeitsplatz blockiert wird.

**Herstellerangaben stehen in der C#-Hülle.** `Exe-bauen.ps1` setzt `AssemblyCompany`,
`AssemblyProduct`, `AssemblyDescription` und die Versionsnummer als Assembly-Attribute; der
Compiler macht daraus die Win32-Versionsressource, die Windows unter *Eigenschaften → Details*
anzeigt. Damit die Umlaute darin ankommen, wird die erzeugte `.cs` mit `/codepage:65001`
übersetzt. **Eine Signatur ersetzt das nicht** — die Warnung „Unbekannter Herausgeber" bleibt,
weil Windows diese Felder nicht prüft.

**Die `.ps1` muss UTF-8 **mit** Signatur (BOM) bleiben.** PowerShell 5.1 liest sie sonst als ANSI
und alle Umlaute in der Oberfläche sind zerstört.

**Keine typografischen Anführungszeichen in doppelt zitierten Zeichenketten.** Das hat einen
ganzen Nachmittag gekostet: PowerShell behandelt `„` (U+201E) und `"` (U+201D) als vollwertige
Zeichenketten-Trennzeichen. Ein `"Den Baustein „$name" löschen?"` **schließt die Zeichenkette am
`„`** — der restliche Code der Zeile und alles bis zum nächsten `"` wird zu Text. Im konkreten
Fall verschwanden rund 90 Zeilen: fünf Ereignisbehandlungen wurden nie angehängt, unter anderem
*Platzhalter einfügen* und *Neues Feld*. Die Knöpfe waren sichtbar und aktiv, taten aber nichts.

Für Anführungszeichen in solchen Meldungen deshalb **Guillemets** `»…«` verwenden — die sind für
den Parser harmlos. In einfach zitierten Zeichenketten (`'…'`) sind `„…"` dagegen unbedenklich.

**`Parser::ParseFile` findet das nicht.** Der Code bleibt syntaktisch gültig, er bedeutet nur etwas
anderes. Eine Syntaxprüfung allein ist also kein Nachweis. Dafür gibt es
`Programm\Selbstpruefung.ps1` — vier Abfragen über den Syntaxbaum, die beim Bauen automatisch
mitlaufen und den Bau abbrechen, wenn etwas anschlägt:

1. Zeichenketten, die sich über mehrere Zeilen ziehen — das Bild, das ein vorzeitig beendetes
   Anführungszeichen hinterlässt.
2. Verschachtelte `GetNewClosure`-Aufrufe (siehe unten).
3. Funktionen, die nirgends aufgerufen werden — meist Reste eines Umbaus.
4. `$script:` außerhalb des erklärenden Kopfkommentars.

Einzeln nachvollziehen lassen sie sich, indem das Skript auf eine absichtlich fehlerhafte Kopie
gerichtet wird:

```bash
powershell -ExecutionPolicy Bypass -File "Programm\Selbstpruefung.ps1" -Datei "kaputt.ps1"
```

**Eine Prüfabfrage braucht eine Gegenprobe.** Zwei der Abfragen standen hier in einer
Fassung, die nie anschlagen konnte: die erste verlangte einen Zeilenabstand von `-ge 2` und übersah
damit jede Zeichenkette über genau zwei Zeilen; die zweite listete lediglich alle
`GetNewClosure`-Aufrufe auf, ohne die Verschachtelung zu prüfen. Beide meldeten zuverlässig „keine
Beanstandung" — und übersahen dabei vier echte Fälle. Eine Abfrage ist erst dann eine Aussage,
wenn sie an einem bekannten Fehler angeschlagen hat.

**Ein Closure im Closure erbt nichts.** Ein `.GetNewClosure()`, das **innerhalb** eines anderen
Closures entsteht, übernimmt dessen Variablen nicht — sie sind beim Auslösen leer. Das ist in
diesem Projekt dreimal passiert, zuletzt beim Kontextmenü der Kategorien, das im
Rechtsklick-Handler gebaut wurde. Zwei Wege heraus:

- Das Menü **einmal** beim Aufbau des Fensters bauen und fest anhängen
  (`$liste.ContextMenuStrip = $katMenue`). Worauf es sich bezieht, merkt sich das Menü im `Tag`;
  das `Opening`-Ereignis füllt es und sagt ab, wo das Menü nicht hingehört.
- Oder alles aus dem Absender lesen und einen einzigen, globalen Handler anhängen — so macht es
  `$global:MarkeEinfuegen` für das Platzhaltermenü.

**PowerShell sucht Variablen über den Aufrufstapel, nicht im Quelltext.** Eine Funktion sieht die
lokalen Variablen ihres *Aufrufers*. Wer in einer Hilfsfunktion einen häufigen Namen wie `$ziel`
oder `$text` liest, bekommt unter Umständen den Wert aus dem aufrufenden Fenster. Bei Prüfläufen
ist das schon aufgefallen: eine Hilfsfunktion las `$ziel` und bekam statt des Pfades eine ListView.
In Hilfsfunktionen deshalb entweder Parameter übergeben oder ausdrücklich `$global:` verwenden.

---

## Was noch fehlt

- **Autotext** — Kürzel direkt beim Tippen ersetzen (`mfg` + Leertaste). Braucht einen
  Tastatur-Hook; bewusst zurückgestellt, weil das im Dienstbetrieb sicherheitstechnisch heikler ist
  als eine bewusst gedrückte Tastenkombination.
- **Blocksatz** — das Rich-Text-Feld von Windows kennt nur links, mittig, rechts.
- **Aufzählungen und Einzüge** — technisch über `PARAFORMAT2` machbar, bisher nicht eingebaut.
- **Bausteine teilen** — eine zweite, schreibgeschützte JSON-Datei aus einem gemeinsamen Ordner
  dazuladen, damit eine Dienststelle gepflegte Vorlagen verteilen kann.
- **Sortierung und Favoriten** in der Schnellwahl, zuletzt benutzte Bausteine nach oben.

---

## Datenschutz

Die Bausteine liegen unverschlüsselt in einer Textdatei, die per USB-Stick transportiert wird.
Bausteine sind **Vorlagen** — Namen, Aktenzeichen und Sachverhalte gehören in die Felder beim
Ausfüllen, nicht in den gespeicherten Text.
