# Präsentationsleitfaden: Final Session Integrationsseminar

Website: `Website/index.html` (Doppelklick genügt, läuft offline).
Jede Ansicht hat einen eigenen Link-Anker, z. B. `index.html#h1-within`. Die Website ist auf Englisch, weil die Präsentation laut Folie 66 „preferably in English“ sein soll. Die Kernsätze unten sind deshalb englisch, die Erklärungen deutsch.

---

## 1. Was die Aufgabenstellung verlangt und wo die Website es zeigt

| Anforderung (Kursfolien) | Wo auf der Website |
|---|---|
| 3–5 Hypothesen (Folie 66) | Overview → *Results at a glance*: H1–H4 als Haupthypothesen |
| Mind. 5.000 Wertepaare je Hypothese, n angeben (Folie 66) | Spalte *n* in der Ergebnistabelle; im Explorer immer oben links. Kleinste Hauptstichprobe: H2 mit 5.704. H8 (2.987) ist ausdrücklich als explorativ markiert |
| r- und p-Werte zeigen (Folie 66) | Tabelle *Results at a glance* und die Kennzahlenleiste jedes Explorers (live) |
| Interpretation nach Kursgrenzen (Folie 39: >0,5 stark, >0,3 moderat, >0,1 schwach, darunter nicht interpretieren) | Stärke-Badge neben r („weak“, „negligible“ …) und Skala *Where each result sits* |
| Correlation ≠ causation, versteckte Variablen (Folie 42) | Fazit-Abschnitt, Methods → *Limits*, Hinweise unter den Kriegsgruppen |
| Schwache Ergebnisse sind auch Ergebnisse (Folie 44) | Fazit „The expected links are weak or reversed“ |
| ca. 10 Minuten, „Show your work instead of PowerPoint slides“ (Folie 66) | Die Website *ist* die Präsentation: Button **Present** führt in 20 Schritten durch, jede Ansicht bleibt dabei voll bedienbar |
| Final Session: „show your work with focus on individual part“ (Folie 67) | Overview → *Individual part: looking inside the averages* und der H1-Deep-Dive |

**Was ist dein Individual Part?** Die gemeinsamen Pflichtteile sind Hypothesen, n, r und p. Dein eigener Teil ist der Blick *in* die Durchschnitte: Auswertungsebene (zwischen vs. innerhalb von Ländern), Kontinente und Kriegsstatus (COW Inter-State War Data) sowie der Einfluss einzelner Länder und Extremfälle. Dazu kommt die interaktive Website selbst als Werkzeug. Genau das zeigst du am Beispiel H1.

---

## 2. Der rote Faden in einem Satz

> *“The relationships I expected are weak or even reversed, but the data tell a clearer story once you change the level of analysis: across countries productivity and army size go together, within a country they move apart, and single countries can flip a regional result.”*

---

## 3. Ablauf für 10 Minuten

Starte mit **Present** oben rechts. Weiter mit → oder Bild↓ (Presenter-Clicker funktionieren), zurück mit ← oder Bild↑, Esc beendet. Du kannst bei jedem Schritt frei klicken und danach mit → weitermachen.

| Zeit | Schritt | Ansicht (Anker) | Was du zeigst und sagst |
|---|---|---|---|
| 0:00 | 1 | `#overview` | Frage, Daten, Methode. *“Eight data sources, 1950 to 2014, up to 259,503 value pairs. Everything you see is recomputed live.”* |
| 0:45 | 2 | `#results` | Pflichtteil in einem Bild: n, r, ρ, p für H1–H4. *“Two hypotheses point the opposite way, two are close to zero.”* Auf die Häkchen „≥ 5,000 value pairs each“ zeigen. |
| 1:45 | 3 | `#h1` | **Start Individual Part.** H1 erwartet negativ, beobachtet r = +0,240 (schwach). Mit der Maus über Punkte fahren: VAE ganz rechts, Irak 1990 oben. |
| 2:15 | 4 | `#h1-outliers` | Einflussreichstes Land: VAE (orange). Ohne VAE r = +0,162, bleibt positiv. |
| 2:35 | 5 | `#h1-trimmed` | Trimmen +0,183, Winsorisieren +0,236. *“The sign is not an outlier artefact.”* |
| 2:55 | 6 | `#h1-between` | Ein Punkt pro Land: r = +0,396. Die Länderjahre ziehen sich sichtbar zu ihrem Länderschnitt zusammen, das ist das Bild für „between“. |
| 3:20 | 7 | `#h1-within` | Abweichungen vom eigenen Länderschnitt: r = −0,165. Die Schnitte zerfallen wieder in ihre Jahre, die sich um den Nullpunkt sammeln. **Kernaussage**: *“Rich countries keep more soldiers per capita, but when a country becomes more productive, its personnel ratio tends to fall.”* Optional: Fixed-Effects-Box unten rechts (β = −1,42, p = 0,11, also negativ, aber unsicher). |
| 4:00 | 8 | `#h1-continents` | Ein kleines Diagramm pro Kontinent (*Split by group*, gleiche Achsen, mittlere 98 %), jedes mit eigener Trendlinie; gestrichelt die Linie aller Punkte: Europa −0,426 und Ozeanien −0,660 (nur 3 Länder!) fallen, Afrika +0,194 und Asien +0,268 steigen. Live-Variante: links nur *Europe* und *Africa* anklicken (`#h1-europe-africa`). |
| 4:30 | 9 | `#h1-northamerica` | Nordamerika +0,144, USA orange hervorgehoben. |
| 4:50 | 10 | `#h1-northamerica-without-usa` | **Der Wow-Moment:** ohne die USA r = −0,107. Ein Land dreht das Vorzeichen. Auf dem Beamer: die USA-Punkte leuchten orange auf und verschwinden, die Trendlinie kippt, r zählt von +0,144 auf −0,107. Auf die Leiste *Steps* zeigen: Full sample +0,240 → North America +0,144 → Without USA −0,107. Links in der Länderliste steht „with it +0,144 · effect −0,251“. |
| 5:15 | 11 | `#h1-usa` | Nur die USA: r = −0,870 über 65 Jahre. Gruppen nach Jahrzehnt rechts. |
| 5:45 | 12 | `#h1-war` | Ohne erfassten Krieg +0,288 (n = 6.350), mit Krieg +0,037 (n = 211). Punkte nach Kriegsstatus eingefärbt. *“Different groups, not a causal war effect.”* |
| 6:15 | 13 | `#h1-frequent-wars` | Kriegshäufige Länder (> 2,66 % Kriegsjahre) raus: r = +0,219 bei 4.530. Das Vorzeichen hängt nicht an kriegsanfälligen Staaten. |
| 6:45 | 14 | `#h2-levels` | H2: erwartet positiv, beobachtet −0,124. Between −0,167, within −0,015. |
| 7:20 | 15 | `#h3-angola` | H3: richtige Richtung, aber −0,033. Angola 1993: +1.501 % Ausgabensprung, 79 Paare in einem Jahr. |
| 7:45 | 16 | `#h3-without-angola` | Ohne Angola −0,060: fast doppelt so stark, aber immer noch vernachlässigbar. |
| 8:05 | 17 | `#h4-americas` | H4 global −0,018. Nord-/Südamerika +0,335, USA orange. |
| 8:25 | 18 | `#h4-americas-without-usa` | Ohne USA +0,033. Wieder macht ein großer Partner das regionale Muster. |
| 8:45 | 19 | `#e5-geography` | Nebenfrage E5: Entfernung erklärt Handel besser als Wohlstand (r = −0,243); gemeinsame Grenze im Gruppenvergleich. |
| 9:15 | 20 | `#conclusion` | Drei Takeaways und Grenzen. Danach: *“What would you like to see? Pick a country or a region.”* |

**Wenn noch Zeit ist oder jemand „Warum?“ fragt:** oben in der Leiste **Why?** öffnen (`#why`), siehe Abschnitt 5a.

**Wenn die Zeit knapp wird:** Schritte 5, 11, 16 und 19 überspringen (je ein Mal → drücken). Der Kern sind die Schritte 3, 6, 7, 8, 10.

---

## 4. Live in die Daten gehen (für Rückfragen)

Alles im Explorer der jeweiligen Hypothese, z. B. `#h1`:

| Du willst … | So geht’s |
|---|---|
| die USA herausnehmen | Links *Countries* → „United States“ tippen → Enter. Oder im Panel *Influential countries* bei einem Land auf **Exclude** klicken. |
| Zwischenergebnisse beim Länderfilter verfolgen | Jede Filteränderung erzeugt einen Schritt in der Leiste **Steps** unter den Kennzahlen (n, r, Änderung zum Schritt davor). Klick auf einen Schritt springt dorthin zurück; *Start from here* räumt den Verlauf auf. In der Länderliste links steht für jedes Land live: bei *Exclude* „rows out · r mit diesem Land · effect“, bei *Only these* „own r“ (das Land allein) und „others“ (die übrigen ohne es). Fährt man mit der Maus über ein Land (Liste oder Einfluss-Tabelle), werden seine Punkte im Scatter schwarz hervorgehoben, auch wenn es ausgeschlossen ist. |
| Kennzahlen im Blick behalten | Die Kennzahlenleiste bleibt beim Scrollen oben stehen. Die Zahlen zählen bei jeder Änderung vom alten zum neuen Wert, darunter steht „▲/▼ … vs previous step“. Die Skala unter r zeigt den aktuellen Wert (Punkt), den vorherigen Schritt (Hohlpunkt) und die erwartete Richtung (grüner Balken). |
| in den Scatter hineinzoomen | Mit der Maus ein Rechteck aufziehen. **Pan** (oder Shift + Ziehen) verschiebt den Ausschnitt, Strg/⌘ + Scrollen zoomt an der Mausposition, + und − zoomen zur Mitte, Doppelklick oder *Reset zoom* setzt zurück. Über dem Diagramm erscheint dann live: „x von n Punkten sichtbar · r in view“. Das Jahresdiagramm zoomt durch Ziehen über die Jahre. |
| sehen, was sich ändert | Jede Änderung wird animiert, damit das Publikum folgen kann: Punkte, die ein Filter entfernt, leuchten kurz orange auf und verschwinden; neue wachsen hinein; die Trendlinie gleitet auf ihre neue Lage. Beim Ebenenwechsel ziehen sich die Länderjahre zu ihrem Länderschnitt zusammen (und zurück). Zoom gleitet zum neuen Ausschnitt, die Balken im Gruppenvergleich wachsen auf ihre neue Länge, neue Schritte rutschen in die Leiste *Steps*. Bei H3/H4 (über 40.000 Punkte) wird überblendet statt jeder Punkt bewegt. Mausrad-Zoom und Pan reagieren ohne Verzögerung. |
| Scatter groß zeigen | **Expand** neben „All rows / Country means / Within“: Scatter über den ganzen Bildschirm, mit n, r, ρ und p darüber. Esc oder *Close* schließt. |
| mehr Platz für die Diagramme | Pfeil oben in der Filterleiste klappt sie ein; der schmale Streifen *Filters* (mit Zahl der aktiven Filter) öffnet sie wieder. |
| nur die USA ansehen | Links unter *Countries* auf **Only these** umschalten, oder **Only** in der Einfluss-Liste |
| nach Kontinent / Krieg / Jahrzehnt gruppieren | Rechts *Compare groups* → Dropdown. Klick auf eine Zeile filtert auf diese Gruppe, zweiter Klick hebt den Filter auf |
| mehrere Gruppen farbig vergleichen | Links zwei oder mehr Kontinente oder Kriegsstatus anklicken, oder mehrere Länder unter **Only these** eintragen. Im Gruppenvergleich geht das mit Shift-Klick. Jede Gruppe bekommt im Scatter eigene Farbe, eigene Form und eigene Trendlinie; die Legende zeigt n und r je Gruppe, die gestrichelte Linie gilt für alle Punkte zusammen. Mit *Color* über dem Diagramm lässt sich die Färbung auch fest wählen (Continent, War status, Selected countries) oder abschalten |
| viele Gruppen übersichtlich zeigen | **Split by group** über dem Scatter: ein kleines Diagramm pro Gruppe mit denselben Achsen, die Gruppe farbig, alle anderen Punkte grau dahinter, eigene Trendlinie, n und r im Kopf. + / − zoomen alle Felder gleichzeitig. Funktioniert für Kontinente, Kriegsstatus und unter *Only these* gewählte Länder (z. B. USA, DEU, JPN: jedes Land stark negativ, zusammen +0,008). Im überlagerten Bild: mit der Maus über eine Gruppe in der Legende oder in *Compare groups* fahren, dann liegt nur diese Gruppe farbig obenauf und ihre Linie wird kräftig; Klick in der Legende hält sie fest, zweiter Klick löst. |
| Kontinentpaare (H3/H4) | Dropdown *Continent pair*: jedes Paar genau einer Kombination zugeordnet (exklusiv); *Continent* zählt Paare dagegen überlappend |
| Ebene wechseln | Über dem Diagramm: **All rows / Country means / Within** |
| Ausreißer prüfen | Links *Outliers*: Full / Trim / Winsorise; Tab *Extreme cases* zeigt die oberen und unteren Fälle |
| Zeitraum einschränken | Links *Years* (z. B. 1990–2007) |
| Kriegsanfällige Länder ausschließen | Links *War-prone countries* (gleiche Regeln wie im Notebook) |
| ein Land genauer ansehen | Punkt anklicken oder Tabellenzeile anklicken → Tab *Selected*: eigenes r, r ohne dieses Land, Kriegsjahre |
| Hervorhebung wieder entfernen | Dasselbe Land noch einmal anklicken (im Scatter oder in der Einfluss-Liste), auf eine leere Stelle im Scatter klicken, in der Legende auf das × neben dem Ländernamen klicken oder Esc drücken. Im Tab *Selected* geht auch *Clear*. |
| Rohdaten zeigen | Unten *Data*: suchen, nach Spalten sortieren, CSV herunterladen (lokal) |
| Glaubwürdigkeit belegen | *Methods* → **Run the check**: Website rechnet alle 10 Hypothesen nach und vergleicht mit dem Notebook (alle „matches“) |

Die aktiven Filter stehen als Chips in der Leiste *Steps*; × entfernt einen, *Reset all* setzt zurück. Die Kennzahl *Full sample* rechts zeigt immer, wie weit du dich vom getesteten Ergebnis entfernt hast.

---

## 5a. Erklärungsseite „Why?“ (`#why`)

Eigene Seite, getrennt vom Explorer. Zu erreichen über **Why?** in der oberen Leiste, über die Karten *Why the results look like this* auf der Übersicht und im Explorer von H1–H4 über den Knopf **Why this result? Explanations with sources** unter der Hypothese.

Pro Hypothese H1–H4:
- **What we found:** die Kennzahlen auf einer Skala von −0,6 bis +0,6, schraffiert der nicht interpretierte Bereich |r| < 0,1.
- **In short:** die Antwort in zwei Sätzen.
- **Zwei Grafiken**, die meisten direkt aus den Projektdaten. H1: Länderdurchschnitte steigen mit der Produktivität, während die Pfade von USA, Großbritannien, Frankreich, Südkorea und Taiwan fallen; dazu die USA 1950–2014 mit Kriegsjahren, Ende der Wehrpflicht 1973 und Ende des Kalten Kriegs. H2: Personal nach Quartilen der Importkonzentration und Konzentration nach Jahrzehnt.
- **Erklärungskarten** nach Art (Forschung, Geopolitik, Geschichte, Statistik): je eine kurze Erklärung mit nummerierten Quellen, ein Beleg „In our data“ und ein Link zur passenden Explorer-Ansicht.
- **Sources:** vollständige Literaturangaben mit DOI-Link. Fährt man mit der Maus über eine Quellennummer, steht die Angabe im Tooltip; ein Klick springt zur Liste.

Alle 22 Quellen wurden geprüft: 20 über ihre DOI (löst beim Verlag auf und passt laut Crossref zu Autor, Titel, Band und Seiten), dazu die RAND-Monografie und der Artikel der U.S. Army über ihre Seiten. Wichtig für Rückfragen: Die Erklärungen passen zu den Zahlen, sind im Projekt aber **nicht getestet**. Die Seite sagt das oben ausdrücklich.

Kernsätze, falls jemand nachfragt:
- *H1:* “Across countries, threats and oil go with large forces; within countries, growth goes with fewer soldiers.”
- *H2:* “Concentrated imports often mean one big partner, through an alliance or a colonial past, and protection by that partner.”
- *H3:* “Budgets follow threats, neighbours and wars, not trade partners. Angola 1993 dominates the Pearson value.”
- *H4:* “Linder and endowment differences pull in opposite directions; distance matters ten times more.”

## 5. Nebenhypothesen: kurz und ehrlich

Nicht einzeln durchgehen. Ein Satz plus eine Ansicht reicht:

> *“After the first results I added six exploratory side questions to look for explanations. They are post-hoc, so I treat them as hints, not as confirmed findings.”*

Zuordnung, falls jemand fragt: E2 (Urbanisierung) zu H1, E1 (Bevölkerung) zu H2, E3–E5 (Größe, Asymmetrie, Entfernung) zu H4. H8 bleibt mit 2.987 Paaren unter der 5.000er-Grenze. Zeigen: Overview → Skala *Where each result sits* (alle zehn auf einen Blick) oder Schritt 19 (E5).

---

## 6. Vorbereitung auf Fragen

**„Warum sind die p-Werte so winzig, obwohl r schwach ist?“**
Weil n sehr groß ist. Und die Standard-p-Werte unterstellen unabhängige Zeilen, obwohl dasselbe Land jedes Jahr wieder vorkommt. Deshalb zeigt die Website zusätzlich das Fixed-Effects-Modell mit geclusterten Standardfehlern: für H1 p = 0,11.

**„Warum dreht sich H1 zwischen den Ebenen?“**
Ein Aggregationseffekt (ähnlich Simpson-Paradox): Reiche Länder (USA, Golfstaaten, Israel, Taiwan) haben hohe Produktivität *und* große Armeen pro Kopf. Innerhalb eines Landes steigt die Produktivität über die Zeit, während der Personalanteil sinkt (USA allein: −0,87).

**„Ist das ein Kriegseffekt?“**
Nein. COW erfasst nur zwischenstaatliche Kriege bis 2007, keine Bürgerkriege. NMC zählt Personal zum 1. Januar, der Kriegsstatus gilt für das ganze Kalenderjahr. Die Gruppen unterscheiden sich, eine Ursache ist damit nicht nachgewiesen.

**„Warum nicht einfach die Ausreißer löschen?“**
Weil es echte Beobachtungen sind (z. B. VAE 1980, Irak 1990). Stattdessen zeigt die Website Trimmen, Winsorisieren und Länderausschluss als Sensitivität. Das Vorzeichen bleibt bei H1 stabil.

**„Warum ist bei H3 Spearman (−0,18) so viel stärker als Pearson (−0,03)?“**
Sehr schiefe Verteilung durch extreme Ausgabensprünge mit kleinem Vorjahresnenner (Angola 1993). Ränge sind davon kaum betroffen.

**„Warum ist Ozeanien so extrem?“**
Nur drei Länder bei H1. Kleine Gruppen sind im Gruppenvergleich schraffiert (unter 30 Zeilen) und nicht verallgemeinerbar.

**„Hast du die Hypothesen nachträglich angepasst?“**
Nein. H1–H4 bleiben wie formuliert und werden mit ihrem schwachen bzw. gegenteiligen Ergebnis berichtet. Teilgruppen sind explorativ, keine Bestätigung.

---

## 7. Technik-Checkliste vor dem Termin

1. **Öffnen:** `Website/index.html` per Doppelklick (Chrome, Edge oder Firefox). Alles läuft ohne Internet; nur die Schriftarten fallen offline auf Systemschriften zurück.
2. **Alternative mit lokalem Server**, falls ein Browser lokale Dateien blockiert:
   ```bash
   python3 -m http.server 8765 --directory "Website"
   ```
   dann `http://localhost:8765` öffnen (im Projektordner ausführen).
3. **Vorladen:** Vor Beginn einmal `#h4` öffnen. Die Paar-Datei (11 MB) lädt dann einmalig, danach ist alles sofort da.
4. **Beamer:** Schrift und Diagramme wachsen automatisch mit der Bildschirmbreite (bei 1920 px etwa 15 % größer als am Laptop). Falls nötig zusätzlich mit Strg/Cmd + zoomen. Hell ist auf Beamern meist besser lesbar (Theme-Button oben rechts). Für den großen Moment: **Expand** am Scatter.
5. **Animationen:** laufen nur flüssig, solange das Browserfenster sichtbar ist (nicht minimiert). Ist in macOS unter *Bedienungshilfen → Anzeige* „Bewegung reduzieren“ aktiv, schaltet die Website alle Animationen ab und zeigt Ergebnisse sofort. Vor dem Termin einmal die Tour durchklicken, damit die Daten im Speicher sind.
6. **Notebook geändert?** Daten neu exportieren (dauert ca. 20 Sekunden, schreibt nur `Website/data/`):
   ```bash
   .venv/bin/python Website/build_data.py
   ```
7. **Fallback:** Excel-Bericht `Analysebericht_Krieg_Kontinente_…xlsx` und das Notebook offen halten.

---

## 8. Dateien der Website

| Datei | Inhalt |
|---|---|
| `index.html` | Einstieg |
| `js/content.js` | Alle Texte, Hypothesen, vorbereitete Ansichten und die 20 Tour-Schritte (hier Formulierungen ändern) |
| `js/stats.js` | Statistik: Pearson + p, Spearman, Between/Within, Länderausschluss, Trimmen, Fixed Effects |
| `js/app.js`, `js/charts.js`, `css/app.css` | Oberfläche und Diagramme |
| `data/*.js` | Aus dem Notebook exportierte Stichproben (nicht von Hand bearbeiten) |
| `build_data.py` | Export-Skript: führt die Notebook-Zellen aus und schreibt `data/` |
