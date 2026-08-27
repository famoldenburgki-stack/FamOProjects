# Arztrechnungen

Lokale Verwaltung von Arztrechnungen für eine privat versicherte, beihilfeberechtigte
Familie. Ersetzt die Excel-Tabelle und den Stempel auf der Papierrechnung: Rechnungen
werden hochgeladen und automatisch ausgelesen, Einreichungen bei DBV und Beihilfe
getrennt verfolgt, und erhaltene Bescheide werden hochgeladen, automatisch den
Rechnungen zugeordnet und gegen die erwartete Erstattung geprüft.

Alle Daten bleiben ausschließlich auf diesem Rechner.

## Start

```bash
npm install
```

```bash
npm run dev
```

Danach im Browser öffnen: **http://localhost:5173**
(Backend läuft parallel auf Port 4000.)

Für den dauerhaften Betrieb einmal bauen und dann nur noch den Server starten –
das Frontend wird dabei mit ausgeliefert, es genügt ein Prozess:

```bash
npm run build
```

```bash
npm start
```

Dann läuft alles unter **http://localhost:4000**.

Am bequemsten per Doppelklick auf **`Arztrechnungen.lnk`** – die Verknüpfung trägt
das App-Icon, startet den Server und öffnet die App im Browser. Eine Kopie liegt auf
dem Desktop. Das schwarze Fenster muss offen bleiben, solange du die App benutzt;
Schließen beendet sie.

Eine `.cmd`-Datei kann selbst kein eigenes Icon tragen – das ist eine
Windows-Eigenheit. Deshalb gibt es die Verknüpfung: sie zeigt auf
`Arztrechnungen.cmd` und bekommt ihr Symbol aus `Arztrechnungen.ico`.

Das Icon wird aus demselben Motiv wie `frontend/public/icon.svg` erzeugt – neu
zeichnen (etwa nach einer Farbänderung) mit:

```bash
npm run --workspace backend icon
```

Danach die Verknüpfung einmal neu anlegen oder Windows neu anmelden, damit der
Symbol-Zwischenspeicher aktualisiert wird.

## Was die App übernimmt

**Rechnung hochladen** – PDF oder Foto auswählen (auch mehrere auf einmal). Arzt,
Rechnungsnummer, Rechnungs- und Behandlungsdatum, Betrag und Behandlungsart werden
ausgelesen und vorausgefüllt; der Patient wird anhand des Namens im Dokument erkannt.
Du prüfst kurz und speicherst. Die App legt automatisch beide Vorgänge an (Beihilfe
und DBV) und berechnet die erwartete Erstattung aus dem Beihilfesatz der Person.

**Zahlungsfrist** – Steht auf der Rechnung ein Zahlungsziel („zahlbar bis 15.03.2026“,
„innerhalb von 14 Tagen“, „sofort ohne Abzug“), liest die App es mit und trägt es als
*Zahlbar bis* ein. Eine Tagesfrist wird auf das Rechnungsdatum gerechnet; das steht als
Hinweis am Formular, damit du es gegenprüfen kannst. In der Übersicht zeigt die Spalte
*Zahlung* je Rechnung „✓ bezahlt“ oder den Knopf **bezahlt** samt Restlaufzeit – gelb ab
einer Woche vorher, rot wenn die Frist verstrichen ist. Die Kennzahl *Noch an Ärzte zu
zahlen* nennt die Summe, das Häkchen *nur unbezahlte* filtert danach. Fällige Zahlungen
stehen zuoberst in den Aufgaben.

**Einreichen** – Das eigentliche Einreichen passiert weiterhin in den Apps von DBV und
Beihilfe; dafür gibt es keine Schnittstelle. In dieser App klickst du danach
„Heute eingereicht“ – das ersetzt den Stempel auf dem Papier.

Für den Weg dorthin sitzen oben rechts drei Knöpfe: **📁 Ablage** öffnet den
Ablageordner im Explorer, **Beihilfe ↗** und **DBV ↗** die Anmeldeseiten der beiden
Portale. In der einzelnen Rechnung zeigt *📁 Im Ordner zeigen* den Beleg markiert im
Explorer – von dort direkt ins Portal hochladen. Die beiden Adressen lassen sich unter
*Einstellungen → Portale zum Einreichen* ändern.

Eingetragen sind `https://ebeihilfe.hessen.de/anmelden` und
`https://www.dbv.de/site/dbv-de/redirect/MyAxaLogin`. Wichtig bei der DBV: nicht die
Adresse aus der Adressleiste des angemeldeten Portals kopieren – die enthält einen
Sitzungstoken (`entry.axa.de/sls-myaxa/auth?RequestedPage=…`), der abläuft und danach
nur noch „Error 403 Forbidden" liefert. Die Weiterleitung über dbv.de holt den Token
bei jedem Aufruf neu. Genauso gut geht
`https://entry.axa.de/kunde/myaxa/member/webapp/`.

### Einreichen (Sammelvorgang)

Der Reiter **Einreichen** listet alles auf, was noch offen ist – getrennt nach Stelle
und Zugang, weil du dich für jeden Zugang einzeln anmeldest. Je Gruppe stehen
**Anzahl Belege** und **Gesamtbetrag** groß oben; beides fragt die Beihilfe in ihrer
Eingabemaske ab, und beides zählt mit, wenn du einzelne Belege abwählst.

- **📁 Belege bereitlegen** kopiert die gewählten Belege durchnummeriert nach
  `<Ablage>/Einreichungen/<Datum> <Stelle> <Zugang>/` und öffnet den Ordner. Dazu
  entsteht `00 Übersicht.txt` mit Anzahl, Gesamtbetrag und der Belegliste zum
  Abhaken. Kopiert, nicht verschoben – das Archiv bleibt vollständig.
- Der Portal-Knopf öffnet die Anmeldeseite der jeweiligen Stelle.
- **Als eingereicht abhaken** setzt nach dem Absenden alle gewählten Einreichungen
  auf einmal auf „eingereicht am heute".

Belege ohne hinterlegte Datei sind gekennzeichnet und stehen im Merkzettel – die
musst du selbst heraussuchen. Abgelegte Rechnungen mit noch offener Einreichung
erscheinen ebenfalls, markiert mit „abgelegt": das ist ein Widerspruch, bei dem sonst
still Geld liegen bliebe.

Die App meldet sich **nicht selbst** in den Portalen an. Beide verlangen eine
Anmeldung mit zweitem Faktor und erkennen automatisierte Zugriffe; ein Skript, das
sich dort einloggt, müsste diese Schutzmechanismen umgehen, bräche bei jedem Umbau
der Portalseite und könnte eine Einreichung stillschweigend verschlucken – bei einer
Ausschlussfrist ist das bares Geld. Anmelden und Absenden bleiben deshalb bei dir.

**Bescheid prüfen** – Den in der DBV- oder Beihilfe-App heruntergeladenen Bescheid
hochladen, das ist alles: **Absender und Zugang erkennt die App selbst.** Sie liest die
Positionen aus, ordnet sie den Einreichungen zu, vergleicht den erstatteten mit dem
erwarteten Betrag und schreibt Status, Betrag, Bescheiddatum und erkannten
Kürzungsgrund direkt in die Rechnung.

Ausschlaggebend für den Absender ist der **Briefkopf**, nicht der Fließtext: eine
DBV-Abrechnung erwähnt im Text regelmäßig die Beihilfe („abzüglich Beihilfeanteil"),
ein Beihilfebescheid die private Krankenversicherung. Wer bloß nach Stichwörtern im
ganzen Dokument sucht, verwechselt beide. Der Zugang ergibt sich aus dem
Anschriftenfeld – dort steht die beihilfeberechtigte bzw. versicherte Person, während
weiter unten die Namen der behandelten Kinder stehen.

Gemessen an allen 138 vorliegenden Bescheiden: **Absender 138 von 138 richtig, Zugang
138 von 138 richtig.** Zwei Dokumente weichen von ihrem Ordner ab – das sind DBV-Briefe,
die im Beihilfe-Ordner liegen; die Erkennung liegt dort richtiger als die Ablage.

Eine **Auswahl fragt die App nur im Zweifelsfall**: wenn der Briefkopf nichts hergibt
und auch der Gesamttext keinen Ausschlag gibt. Dann bleibt die Datei ausgewählt, zwei
Auswahlfelder erscheinen, und ein Klick auf „Erneut prüfen" genügt. Beim Zugang wird
im Zweifel der wahrscheinlichste genommen und ein Hinweis ausgegeben, statt zu
blockieren.

Nachmessen lässt sich das jederzeit:

```bash
npm run --workspace backend absender -- "G:/Pfad/zu/den/Bescheiden"
```

Anschließend siehst du eine Zusammenfassung: was voll erstattet wurde, was gekürzt
oder abgelehnt wurde und wo eine Entscheidung nötig ist. Positionen, die nicht
eindeutig zuordenbar sind, werden nicht geraten, sondern zur Bestätigung vorgelegt.

Zwei Formate sind gezielt eingelesen und gegen echte Bescheide geprüft:

- **Beihilfe Hessen** (Regierungspräsidium Kassel): die Tabelle der Anlage mit
  Beleg-Nr., Patient, Leistungsart, Belegdatum, Rechnungsbetrag, beihilfefähigem
  Betrag, Bemessungssatz und Beihilfebetrag. Eine Kürzung erkennt die App daran,
  dass der beihilfefähige Betrag unter dem Rechnungsbetrag liegt. Verrechnungen
  ("abzüglich bereits gezahlt") werden als Hinweis ausgewiesen, damit der niedrigere
  Auszahlungsbetrag nicht als Fehler erscheint. Weicht der Bemessungssatz im
  Bescheid von den Einstellungen ab, warnt die App.
- **DBV-Leistungsabrechnung**: die Abschnitte je Patient mit Rechnungs-,
  Ablehnungs- und Erstattungsbetrag. Die Anmerkungen am Ende des Schreibens werden
  der jeweiligen Position als Begründung zugeordnet und im Originaltext angezeigt.

Da **keiner** der beiden Bescheide die Rechnungsnummer des Arztes nennt, läuft die
Zuordnung über Patient und Rechnungsbetrag, bei Mehrdeutigkeit zusätzlich über
Datum, Behandlungsjahr und Arztname. Andere Bescheidformate werden über allgemeine
Regeln gelesen; die App weist dann ausdrücklich darauf hin, dass die Zuordnung
besonders zu prüfen ist.

Zum Abgleich weiterer Formate gibt es ein Diagnose-Werkzeug, das zeigt, was die App
aus einem Dokument herausliest:

```bash
npm run analyse -- "muster/mein-bescheid.pdf"
```

## Ablage im Dateisystem

Beim ersten Start fragt die App, in welchem Ordner sie die Rechnungen ablegen soll.
Der Pfad wird geprüft, auf Wunsch angelegt, und ein Beispielpfad zeigt vorab, was
entsteht. Später änderbar unter **Einstellungen → Ablageordner**.

Abgelegt wird nach Person und Jahr, benannt nach Datum, Aussteller und Betrag:

```
T:\Arztrechnungen\
  1 Ali\Belege 2026\2026-05-29 Praxis Dr. Fröhlich 63,01 EUR.pdf
  3 Ina\Belege 2021\2021-11-01 Kinderarztpraxis Dr. Sommer 84,14 EUR.pdf
  4 Bela\Belege 2025\2025-01-21 Laborarztpraxis 126,03 EUR.jpg
```

Der Dateiname entsteht aus den Feldern, die du beim Speichern bestätigt hast –
korrigierst du den Ausstellernamen im Formular, steht der korrigierte Name auch im
Dateinamen. Regeln dabei:

- Die Datei liegt **nur** in der Ablage; die App führt keine zweite Kopie.
- Änderst du später Datum, Arzt oder Betrag, wird die abgelegte Datei **umbenannt**.
- Gleichnamige Dateien bekommen „(2)", „(3)" angehängt – nichts wird überschrieben.
- Löschst du eine Rechnung in der App, **bleibt die abgelegte Datei liegen**. Sie
  gehört in deinen Aktenordner, nicht in den der App.
- Ist der Ablageordner nicht erreichbar (Laufwerk getrennt), schlägt nur die Anzeige
  fehl – mit einem entsprechenden Hinweis. Die Erfassung einer Rechnung scheitert
  nie daran; die Datei bleibt dann im App-Ordner.

Ohne eingerichteten Ablageordner bleiben die Dateien in `backend/uploads/`.

## Belege ansehen

Beim Hochladen steht der Beleg **neben dem Formular** – PDFs eingebettet, Fotos als
Bild – und zwar sofort nach der Dateiauswahl, noch während die Texterkennung läuft.
So lassen sich die Vorschläge direkt am Original prüfen.

Gespeicherte Belege lassen sich jederzeit ansehen: in der Übersicht über die Spalte
*Beleg*, in der Rechnungsansicht über *Rechnung ansehen*. Das Fenster bietet
zusätzlich „In neuem Tab öffnen" und „Herunterladen".

## Eingang (überwachter Ordner)

Damit du nichts einzeln hochladen musst, kann die App einen Ordner überwachen –
einen Google-Drive- oder OneDrive-Ordner zum Beispiel, in den du vom Handy aus
abfotografierte Rechnungen legst. **Bescheide gehen genauso**: einen Bescheid, den
du unterwegs im Portal öffnest, legst du einfach in denselben Ordner, statt später
nochmal über Beihilfe oder DBV zu gehen.

**So läuft es:**

1. Du legst ein Dokument in den überwachten Ordner – Rechnung oder Bescheid.
2. Beim nächsten Anmelden am Rechner liest die App den Ordner ein: Texterkennung,
   Felder vorschlagen, Datei in den App-Ordner übernehmen. Ob es eine Rechnung oder
   ein Bescheid ist, entscheidet die Formaterkennung – du musst nichts sortieren.
3. In der App liegt beides unter **Eingang** als *Entwurf*, der Reiter trägt einen
   Zähler:
   - Bei einer **Rechnung** legt „Als Rechnung übernehmen" sie samt beider
     Einreichungen an und legt die Datei im Archiv ab.
   - Bei einem **Bescheid** stehen Absender, Zugang, Bescheiddatum, Erstattung und
     die Zahl der erkannten Positionen zur Kontrolle da – erkannt, nicht erfragt.
     Ändern lässt sich das über „ändern", nötig ist es im Normalfall nicht.
     „Bescheid prüfen und übernehmen" schickt ihn durch genau dieselbe Prüfung wie ein von Hand
     hochgeladener: Positionen zuordnen, mit der erwarteten Erstattung vergleichen,
     Status und Kürzungsgründe in die Rechnungen schreiben.

Es entsteht also **nie automatisch** eine Rechnung oder ein geprüfter Bescheid –
der Eingang sammelt nur vor. „Verworfen" löscht nichts, sondern schiebt die Datei
in den Unterordner `verworfen/` des überwachten Ordners zurück.

Der Schutz vor dem falschen Absender gilt auch hier: passt die Auswahl nicht zum
Dokument (etwa „Beihilfe" bei einer DBV-Abrechnung), wird der Bescheid nur erfasst
und **nichts** in die Einreichungen geschrieben.

**Einrichten:**

- *Einstellungen → Rechnungseingang*: Pfad des überwachten Ordners eintragen.
- `Autostart einrichten.cmd` einmal doppelklicken. Das legt eine Verknüpfung im
  Autostart-Ordner an, sodass der Ordner bei jeder Anmeldung eingelesen wird.
  Rückgängig: Windows-Taste + R, `shell:startup`, Verknüpfung löschen.

Von Hand anstoßen lässt sich das jederzeit – über *Ordner jetzt einlesen* auf der
Eingangsseite oder auf der Kommandozeile:

```
npm run --workspace backend eingang
npm run --workspace backend eingang -- --ordner "C:\Pfad"   einmalig anderer Ordner
```

Dateien werden anhand ihres Inhalts erkannt – dieselbe Datei zweimal im Ordner
erzeugt keinen zweiten Entwurf, egal ob Rechnung oder Bescheid.

### Keine Benachrichtigung per Mail

Bewusst nicht eingebaut. Eine solche Mail müsste Patientennamen, Arzt und Beträge
enthalten und läge damit beim Mailanbieter – für den einzigen Zweck, etwas zu
melden, das ohnehin beim nächsten Öffnen der App auf der Seite **Aufgaben** steht:
ablaufende Fristen, fällige Zahlungen an den Arzt, offene Entscheidungen. Der
Eingang trägt seine Anzahl als Zähler im Reiter.

## Gelernte Aussteller-Muster

Deine Ärzte wiederholen sich – dieselbe Praxis schreibt jahrelang gleich aufgebaute
Rechnungen. Die App nutzt das: **beim Speichern einer Rechnung merkt sie sich, wie
der Beleg dieses Ausstellers aufgebaut ist.** Ist der Aussteller noch unbekannt,
legt sie dafür automatisch ein neues Muster an; bei jeder weiteren Rechnung wird es
sicherer.

Gelernt wird pro Aussteller:

- die **Zeichenform der Rechnungsnummer** (z.B. `A#########` beim Labor, `####-##`
  bei Dr. Welter) – das stärkste Merkmal, weil es je Praxis konstant ist
- hinter welcher **Beschriftung** Betrag und Datumsangaben stehen und wie viele
  Zeilen darunter
- die übliche **Behandlungsart**
- die zuletzt bestätigte **Schreibweise des Namens**, die dann die rohe
  Texterkennung ersetzt

Beim nächsten Beleg wird der Aussteller am Briefkopf wiedererkannt – auch dann,
wenn die Texterkennung ihn diesmal anders schreibt, denn verglichen werden die
markanten Wörter des Briefkopfs, nicht der Name allein.

Das Muster **füllt nur Lücken**: Werte, welche die allgemeinen Regeln bereits
sicher erkannt haben, bleiben unangetastet. Einzige Ausnahme ist die
Rechnungsnummer – passt sie nicht zur sonst immer gleichen Form dieses
Ausstellers, gewinnt das Muster. Was aus dem Muster stammt, steht beim Upload
ausdrücklich dabei.

Gemessener Nutzen an einem echten Handyfoto: die allgemeinen Regeln fanden keine
Rechnungsnummer, das aus fünf Laborrechnungen gelernte Muster lieferte
`A250015222` – obwohl das Foto einen anderen Patienten und ein anderes Jahr
betraf.

Verwalten lassen sich die Muster unter **Einstellungen → Gelernte
Aussteller-Muster**; dort steht je Aussteller, was gelernt wurde, und ein Muster
lässt sich verwerfen.

## Wie der Rechnungsbetrag bestimmt wird

Arztrechnungen führen viele Zahlen: Einzelleistungen, Steigerungsfaktoren,
Zwischensummen je Abschnitt, Umsatzsteuer, Abzüge. Die App sucht deshalb gezielt
die ausgewiesene Endsumme, in dieser Reihenfolge:

1. **Was zu zahlen ist** – „Zu zahlender Betrag", „Zahlbetrag", „Überweisungsbetrag".
   Das schlägt die Bruttosumme, wenn eine Anzahlung abgezogen wurde.
2. **Die ausgewiesene Rechnungssumme** – „Rechnungsbetrag", „Gesamtbetrag",
   „Gesamtsumme", „Liquidationsbetrag", „Endsumme".
3. **Eine Zeile mit „Summe" oder „Gesamt"**, wenn keine der klaren Bezeichnungen
   vorkommt.
4. Sonst der **größte Betrag** des Belegs.

Nur die Stufen 1 und 2 gelten als sicher. In den Stufen 3 und 4 fordert die App
beim Erfassen ausdrücklich zum Gegenprüfen auf.

Damit das auf echten Belegen trägt:

- Die Stichwörter sind **Muster statt fester Wörter**, weil die Texterkennung
  Buchstaben verdoppelt – „zu zahllender Betrag" ist so vorgekommen.
- Zeilen mit *Zwischensumme, Übertrag, Netto, MwSt., abzüglich, Anzahlung,
  Eigenanteil, Punkten, Faktoren, GOÄ-Ziffern, IBAN* zählen nie als Endsumme.
- Kommt ein Stichwort mehrfach vor – in Abschnittssummen, Zahlungsbedingungen,
  Fußzeilen –, gilt der **größte** so bezeichnete Betrag.
- In Folgezeilen wird nur gesucht, wenn die Zeile eine **reine Beschriftung** ist.
  Sonst zog der Fließtext „Der Rechnungsbetrag wird mit Zugang dieser Rechnung
  fällig …" die weiter unten genannte Mahngebühr von 10,00 € als Summe heran.
- **Ein Punkt gilt nur mit Währungsangabe als Dezimaltrenner.** Deutsche Belege
  schreiben Komma; „Steuerbefreiung gem. § 4 Nr. 14 UStG" wurde sonst als
  84,14 € gelesen und war auf mehreren Kinderarztrechnungen der ausgegebene
  Betrag.

Was ein einzelner Beleg liefert, zeigt:

```bash
npm run --workspace backend betrag -- "Pfad/zur/Rechnung.pdf"
```

## Erkennungsgüte

Die Erkennungsregeln sind gegen den vorhandenen Bestand von 315 Belegen aus den
Jahren 2020–2025 geprüft. 97 % davon sind Scans ohne Textebene, laufen also über
Texterkennung. Gemessen an den 303 als Rechnung eingestuften Dateien:

| Feld | erkannt |
|---|---|
| Rechnungsdatum | 95 % |
| Rechnungsbetrag | 89 % |
| Patient | 93 %, davon 96 % richtig |
| Behandlungsdatum | 70 % (teils geschätzt, dann gekennzeichnet) |
| Behandlungsart | 80 % |
| Rechnungsnummer | 64 % |

Die 34 Belege ohne erkannten Betrag sind überwiegend Rezepte, Arztberichte und
Formulare – Dokumente, die gar keine Rechnungssumme tragen.

Von den Abweichungen bei der Patientenzuordnung waren 9 von 11 keine Lesefehler,
sondern Belege, die im Ordner einer anderen Person liegen. Bei 226 Belegen, die
ihr Datum im Dateinamen tragen, stimmt das erkannte Rechnungsdatum in 86 % der
Fälle damit überein; die übrigen sind überwiegend Dateien, die nach dem
Behandlungs- statt dem Rechnungsdatum benannt sind.

Die Prüfungen der Erkennungsregeln laufen mit:

```bash
npm run --workspace backend selftest
```

Einen ganzen Ordner auswerten (misst die Quoten oben, mit Zwischenspeicher):

```bash
npm run --workspace backend batch -- "G:/Pfad/zu/den/Belegen"
```

**Aufgaben** – Nach Dringlichkeit sortiert: ablaufende Ausschlussfristen (hier geht
sonst Geld verloren), Kürzungen und Ablehnungen, die eine Entscheidung brauchen
(Eigenanteil akzeptieren / Arzt kontaktieren / Widerspruch), noch nicht eingereichte
Rechnungen, überfällige Bescheide und Rechnungen, die vollständig erledigt sind und
in die Papierablage können.

**Statistik** – Kostenentwicklung pro Jahr (aufgeteilt in Beihilfe, DBV und selbst
getragenen Anteil), Kosten pro Person und pro Behandlungsart, der Stand der
Beitragsrückerstattung bei der DBV sowie eine Auswertung der Kürzungsgründe nach Arzt.

**Excel-Export** – Erzeugt jederzeit eine Excel-Datei mit einem Blatt pro Jahr –
als Sicherung, für die Steuer oder einfach, um die Zahlen außerhalb der App zu haben.
Zu finden auf der Übersicht und in den Einstellungen.

Einen *Import* gibt es nicht mehr: die alten Jahres-Tabellen sind übernommen, neue
Rechnungen entstehen über den Upload oder den Eingang.

## Einstellungen, die du prüfen solltest

Beim ersten Start legst du den **Haushalt** an: je Person Name, Rolle und
**Beihilfesatz**. Der Satz steht auf jedem Beihilfebescheid als „Bemessungssatz“ –
er hängt vom Dienstherrn und der Familiensituation ab und ist nichts, was die App
raten sollte. Den verbleibenden Anteil übernimmt die private Krankenversicherung.

Der **Zugang** ist die Person, über deren Anmeldung eingereicht wird; Kinder laufen
in der Regel über ein Elternteil. Danach ordnet die App auch Bescheide dem richtigen
Zugang zu.

Ebenfalls dort einzutragen:

- **BRE-Schwelle** pro Person: der Betrag, bis zu dem sich das Einreichen bei der DBV
  lohnt, ohne die Beitragsrückerstattung zu verlieren. Ohne Eintrag bleibt die
  Ampel in der Statistik grau.
- **Ausschlussfristen**: 12 Monate für die Beihilfe (hessischer Regelfall) und
  24 Monate für die DBV sind Voreinstellungen. Maßgeblich ist die Regelung deines
  Dienstherrn bzw. deines Tarifs.

## Wo die Daten liegen

Alles bleibt auf diesem Rechner. Im Einzelnen:

| Ort | Inhalt |
|---|---|
| `backend/data/app.db` | Datenbank: alle Rechnungen, Einreichungen, Bescheide – **einschließlich des vollständigen erkannten Textes** jedes Dokuments |
| `backend/data/sicherung/` | Sicherungskopien der Datenbank |
| `backend/data/ocr-cache/` | nur die deutschen Sprachdaten der Texterkennung, keine Belege |
| `backend/uploads/rechnungen/`, `.../bescheide/` | Zwischenstation beim Hochladen. Von hier wird die Datei ins Archiv **verschoben** – bleibt etwas liegen, ist die Ablage nicht erreichbar oder die Rechnung wurde gelöscht (dann bleibt die Datei absichtlich stehen) |
| `backend/uploads/eingang/` | Belege aus dem überwachten Ordner, solange sie unbestätigt sind |
| Ablageordner (Einstellungen) | die endgültigen Belege und Bescheide, nach Person und Jahr |

Der **überwachte Ordner** liegt in einem Cloud-Ordner – solange eine Datei dort
liegt, liegt sie auch beim Cloud-Anbieter. Die App holt sie heraus, aber der
Anbieter kann eine Kopie im Papierkorb behalten (bei Google Drive 30 Tage).

**Netzwerk.** Der Server lauscht ausschließlich auf `127.0.0.1` – erreichbar nur von
diesem Rechner, nicht von anderen Geräten im Netz. Das ist wichtig, weil die App
**keine Benutzeranmeldung** hat: wer sie erreicht, sieht alles. Wer sie bewusst im
Heimnetz freigeben will, startet mit `ARZTRECHNUNGEN_HOST=0.0.0.0` – und nur in einem
Netz, dem er traut.

**Ausgehende Verbindungen** gibt es genau eine, und die ohne Belegdaten: die
Texterkennung lädt beim allerersten Lauf die deutschen Sprachdaten (ca. 15 MB) und
legt sie in `backend/data/ocr-cache/` ab. Danach arbeitet sie offline. Sonst fragt
die App keinen Dienst im Netz – aus deinen Belegen verlässt also nichts diesen
Rechner.

## Sicherung

Zwei Ordner enthalten alles Persönliche und sind nicht im Git enthalten:

- `backend/data/` – die Datenbank (`app.db`)
- `backend/uploads/` – die hochgeladenen Rechnungen und Bescheide

Für ein Backup genügt es, diese beiden Ordner zu kopieren.

## Betrieb ohne Claude – und Weitergabe an andere

### Die App braucht Claude nicht

Sie läuft vollständig auf deinem Rechner und ruft **keine externen Dienste** auf –
weder Anthropic noch sonst jemanden. Es gibt keinen API-Schlüssel und keine
Anmeldung. Nachprüfbar mit:

```bash
grep -rn "fetch(\|https://\|anthropic\|apiKey" backend/src --include=*.ts
```

Auch die Texterkennung arbeitet lokal (`tesseract.js` als WebAssembly). Die
deutschen Sprachdaten liegen bereits in `backend/data/ocr-cache/deu.traineddata`.
Ist der Ordner vorhanden, funktioniert die App ohne jede Internetverbindung.

Läuft dein Claude-Abo aus, ändert das an der App also nichts. Was entfällt, ist die
Möglichkeit, sie von mir weiterentwickeln zu lassen.

**Damit sie dauerhaft läuft, brauchst du nur:** diesen Ordner und **Node.js 22.5
oder neuer** (kostenlos, nodejs.org). Internet ist einmalig beim Einrichten auf
einem neuen Rechner nötig, um die Pakete zu laden.

### Vorbereiten für den Dauerbetrieb

```bash
npm install
npm run build
npm start
```

`npm start` startet nur das Backend, das die gebaute Oberfläche gleich mit
ausliefert – erreichbar unter `http://localhost:4000`. Kein Entwicklungsmodus, kein
zweites Fenster. Für den Alltag ist das die richtige Variante; `npm run dev` braucht
man nur beim Weiterentwickeln.

Bequemer geht es über die mitgelieferten Skripte: `Einrichten.cmd` richtet alles
ein und legt eine Verknüpfung auf dem Desktop an, `Arztrechnungen.cmd` öffnet die
App und startet den Server, falls er nicht schon läuft.

### Weitergabe an andere

Rechtlich spricht nichts dagegen. Alle verwendeten Bausteine stehen unter
freizügigen Lizenzen:

| Paket | Lizenz |
|---|---|
| express, multer, cors, react, recharts, @napi-rs/canvas | MIT |
| xlsx (SheetJS), pdfjs-dist, tesseract.js | Apache-2.0 |

Der übrige Code gehört dir; du darfst ihn kopieren, verändern und weitergeben.

**Drei Wege, je nach Empfänger:**

1. **Ordner kopieren** – ohne `node_modules`, `backend/data` und
   `backend/uploads`. Der Empfänger braucht Node.js und führt `npm install`,
   `npm run build`, `npm start` aus. Einfachster Weg für technisch versierte Leute.
2. **Auf einem NAS oder Mini-Rechner betreiben** – einmal eingerichtet, erreichbar
   für alle im Heimnetz – dafür muss der Server mit `ARZTRECHNUNGEN_HOST=0.0.0.0`
   gestartet werden, denn ab Werk hört er nur auf diesem Rechner.
   Achtung: die App hat **keine Benutzeranmeldung**; wer das Netz erreicht, sieht
   die Daten. Nicht ins offene Internet stellen.
3. **Als Projekt veröffentlichen** (z.B. auf GitHub) – dann können andere es selbst
   herunterladen. Dafür unbedingt vorher prüfen, dass keine persönlichen Daten
   enthalten sind (siehe unten).

### Was du vor der Weitergabe entfernen musst

Diese Ordner enthalten Gesundheitsdaten deiner Familie und dürfen **nie** mitgehen:

- `backend/data/` – Datenbank mit allen Rechnungen und Bescheiden
- `backend/uploads/` – hochgeladene Dateien
- `muster/` – deine echten Belege und Bescheide

Beim ersten Start legt die App eine leere Datenbank an. Zusätzlich anzupassen sind
in den **Einstellungen**: Familienmitglieder, Beihilfesätze, Zugänge, Ablageordner.

### Was für andere nicht passen wird

Die App ist auf eine bestimmte Lage zugeschnitten. Wer sie übernimmt, sollte wissen:

- Die **Fristen** sind auf die hessische Beihilfe eingestellt (12 Monate). Andere
  Bundesländer haben andere Regeln.
- Die **Bescheiderkennung** kennt zwei Formate: die Beihilfe Hessen
  (Regierungspräsidium Kassel) und die DBV-Leistungsabrechnung. Andere Beihilfestellen
  oder Versicherer werden über allgemeine Regeln gelesen – das funktioniert, ist aber
  deutlich ungenauer und muss sorgfältiger geprüft werden.
- Das Grundmodell **eine Rechnung, zwei Einreichungen (Beihilfe + private
  Versicherung)** passt nur für Beihilfeberechtigte. Für rein privat Versicherte
  ohne Beihilfe wäre die zweite Spalte überflüssig.

Für andere Bundesländer oder Versicherer sind das jeweils überschaubare Änderungen
an `backend/src/ocr/decisionFormats.ts` und den Einstellungen – aber jemand muss sie
machen.

## Technisches

- **Backend**: Node.js + Express + TypeScript, SQLite über das in Node eingebaute
  `node:sqlite` (keine nativen Zusatzpakete, kein Compiler nötig). Benötigt Node 22.5
  oder neuer.
- **Frontend**: React + Vite + Tailwind CSS, Diagramme mit Recharts.
- **Texterkennung**: PDFs mit Textebene werden direkt mit `pdfjs-dist` ausgelesen.
  Bei gescannten PDFs und Fotos rendert die App die Seiten und liest sie per
  Texterkennung (`tesseract.js`). Die deutschen Sprachdaten (ca. 15 MB) werden dafür
  beim ersten Mal einmalig geladen und in `backend/data/ocr-cache/` abgelegt – danach
  funktioniert die Erkennung offline.

### Wichtige Dateien

| Datei | Inhalt |
|---|---|
| `backend/src/db.ts` | Datenbankschema und Startdaten |
| `backend/src/calc.ts` | Erwartete Erstattung, Gesamtstatus, Fristen |
| `backend/src/decisionEngine.ts` | Zuordnung und Prüfung der Bescheid-Positionen |
| `backend/src/ocr/extract.ts` | Textextraktion aus PDF und Bild |
| `backend/src/ocr/parse.ts` | Erkennung von Rechnungs- und Bescheiddaten |
| `backend/src/inbox.ts` | Überwachter Ordner, Entwürfe im Eingang |
| `backend/src/routes/submit.ts` | Einreich-Assistent: Gruppen, Sammelordner, Abhaken |
| `backend/src/createInvoice.ts` | Rechnung anlegen – gemeinsam für Upload und Eingang |
| `backend/src/createDecision.ts` | Bescheid prüfen – gemeinsam für Upload und Eingang, Absender-/Zugangserkennung |
| `frontend/src/pages/` | die einzelnen Seiten der Oberfläche |
