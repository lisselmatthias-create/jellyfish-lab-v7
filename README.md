# Jellyfish Lab V7

Eigenständige WebGL2-Studie mit Quallen-Bewegungsmodellen, Tentakeln,
Strömung, Verhaltenszuständen, Bloom und Kamera. `index.html` kann direkt
im Browser geöffnet oder unverändert über GitHub Pages bereitgestellt werden.
Keine externen Skripte, Fonts, Assets oder npm-Abhängigkeiten.

## Stabilität und Wiederherstellung

- Bei `webglcontextlost` wird die Standardbehandlung verhindert und die einzige
  Animationsschleife abgebrochen. Ungültige GPU-Handles werden verworfen.
- Bei `webglcontextrestored` werden Shaderprogramme, Uniform-Locations, beide
  VAOs, alle drei Buffer sowie Szene-/Bloom-Texturen, Framebuffer und der
  Depth-Renderbuffer neu erstellt. Die vorhandene CPU-Geometrie wird erneut
  hochgeladen. Es gibt keinen Seiten-Reload und keinen Preset-Reset.
- Parameter, Kamera, Simulationszeit, Verhaltenszustand, hydrodynamischer Zustand
  und Geometrie bleiben im Speicher erhalten. Änderungen an Reglern während
  eines Kontextverlusts werden bei der Wiederherstellung berücksichtigt.
- `visibilitychange`, `pagehide` und `pageshow` pausieren bzw. starten die
  Animation. Der erste Frame nach dem Fortsetzen hat `dt = 0`; Hintergrundzeit
  wird nicht nachsimuliert. Mehrere Startsignale erzeugen keine zweite Schleife.
- Unvollständige Framebuffer und Fehler bei der GPU-Initialisierung stoppen den
  Renderer mit einer Fehlermeldung. **Performance → Renderer erneut starten**
  erlaubt einen neuen Versuch ohne Zurücksetzen der Einstellungen. Das Menü
  bleibt auch auf schmalen Bildschirmen zugänglich.

Ein Kontext kann nur wiederhergestellt werden, wenn der Browser ihn freigibt.
Währenddessen wartet die Anwendung ohne Renderloop. Diese Erhaltung gilt für
Kontextverluste und Hintergrundpausen innerhalb derselben Seite; ein vom
Betriebssystem vollständig verworfener Tab, ein Reload oder Schließen des
Browsers ist keine persistente Sitzungsspeicherung.

## Renderauflösung und Messwerte

Das Performance-Menü bietet drei adaptive Budgets:

| Profil | Zielbildrate | maximaler DPR | maximales Szenen-Pixelbudget |
| --- | ---: | ---: | ---: |
| Balanced | 60 FPS | 2 | 4.000.000 |
| Battery | 30 FPS | 1,25 | 1.800.000 |
| Quality | 60 FPS | 2,5 | 6.500.000 |

Die effektive Auflösung berücksichtigt CSS-Abmessungen, Geräte-DPR, Pixelbudget
und die Grenzen für Texturen, Renderbuffer und Viewports. Der adaptive Faktor
liegt zwischen 50 und 100 Prozent dieser Ausgangsauflösung. Bloom bleibt in
halber Szenenauflösung erhalten; Geometrie und kreative Parameter werden nicht
reduziert. Die Punktgröße wird beim Skalieren relativ zum ursprünglichen
DPR-Verhalten kompensiert.

Die Regelung verwendet echte Zeitabstände zwischen gerenderten Frames, getrennt
vom weiterhin auf 50 ms begrenzten Simulationsschritt:

- FPS = Anzahl der Frames / verstrichene Zeit, aktualisiert etwa einmal pro Sekunde.
- P95 = 95. Perzentil der Frame-Abstände im Messfenster, einschließlich Frame-Pacing;
  dies ist **keine GPU-Zeitmessung**.
- Nach Start, Fortsetzen oder einer Neuallokation wird eine Sekunde aufgewärmt.
- Unter 82 Prozent der Zielbildrate für mindestens zwei gemessene Sekunden wird
  der Faktor um 10 Prozentpunkte gesenkt.
- Über 95 Prozent der Zielbildrate und bei ausreichend gleichmäßigen Frames für
  mindestens acht gemessene Sekunden wird er um 5 Prozentpunkte angehoben.
- Zwischen Anpassungen liegen mindestens vier gemessene Sekunden; zusätzlich
  gilt die Aufwärmphase. Dies vermeidet häufige Framebuffer-Neuallokationen.

Die Zielbildrate ist ein Budget, keine Leistungszusage. CPU-intensive Geometrie,
Thermik und Browserbeschränkungen können die Bildrate auch bei niedriger Auflösung
begrenzen. Die Regelung entfernt deshalb keine Tentakel oder Effekte.

CSS bestimmt die Canvas-Größe. ResizeObserver, Fenster-/VisualViewport-Resize
und DPR-Wechsel markieren eine ausstehende Anpassung; unveränderte Abmessungen
lösen keine neue GPU-Allokation aus. Uniform-Locations sind zwischengespeichert.
PNG-Export rendert synchron neu und benötigt kein dauerhaft erhaltenes
Drawing Buffer.

## Tests ausführen

### Deterministische Tests

Mit Node.js ab Version 22, ohne Installation von Paketen:

```sh
node --test tests/*.test.mjs
```

`policy.test.mjs` prüft Auflösungen bis 8K, DPR 1–3, GPU-Grenzen, langsame und
schnelle Leistungsprofile, Hysterese, FPS unter 20 und Aufwärmphasen.
`lifecycle.test.mjs` führt das tatsächliche Inline-Skript mit kontrollierter
DOM-/WebGL-Umgebung aus: genau eine RAF-Schleife, Hintergrundpause ohne Zeitsprung,
mehrfache Wiederherstellung, unveränderte CPU-Zustände, keine veralteten Handles
oder übriggebliebenen Ressourcen, Shader-/Framebuffer-Fehler und 30-/60-FPS-Pacing
auf 60-, 90-, 120- und 144-Hz-Zeitachsen. Diese Doubles ersetzen keine GPU-Tests.

### Echte WebGL2-Browsertests

`tests/browser.html` über einen lokalen HTTP-Server öffnen, zum Beispiel:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Dann `http://127.0.0.1:8000/tests/browser.html` öffnen und sichtbar lassen.
Die Tests verwenden die echte Erweiterung `WEBGL_lose_context`. Eine fehlende
Erweiterung wird als fehlgeschlagener Test angezeigt und nicht still übersprungen.
Sie prüfen unter anderem drei aufeinanderfolgende Verlust-/Wiederherstellungszyklen,
alle Presets und Bewegungsmodelle, Änderungen während des Verlusts, neue GPU-Objekte,
Framebuffer-Vollständigkeit, PNG-Inhalt sowie einen absichtlich ausgelösten
Framebuffer-Fehler mit anschließendem Neustart. Hintergrundereignisse werden
gezielt synthetisch ausgelöst; `document.hidden` wird für diesen Test überschrieben.
Die dabei absichtlich erzeugte WebGL-Fehlermeldung in der Konsole ist erwartet.

Für automatisierte Bildschirm-/Leistungsprofile genügt ein installiertes
Chromium/Chrome plus Node.js; der Runner verwendet das eingebaute DevTools-Protokoll:

```sh
CHROME_BIN=/pfad/zu/chromium node tests/run-browser.mjs
```

Er startet seinen eigenen lokalen Server und prüft:

| Profil | Viewport | DPR | CPU-Drosselung |
| --- | --- | ---: | ---: |
| Desktop | 2560 × 1440 | 1 | 1× |
| Tablet Hochformat | 820 × 1180 | 2 | 1× |
| Tablet Querformat | 1180 × 820 | 2 | 4× |
| 4K | 3840 × 2160 | 1 | 1× |
| Smartphone | 390 × 844 | 3 | 1× |

Jedes Profil durchläuft die drei Renderbudgets. Der Runner verwendet SwiftShader
für reproduzierbare WebGL-Funktionstests; CPU-Drosselung und Viewport-Emulation
simulieren kein reales iPad und liefern keinen M4-Benchmark. Nur in einer
isolierten Root-Testumgebung bei Bedarf `CHROME_NO_SANDBOX=1` setzen. Optional:
`TEST_REPORT=/pfad/report.json` und `TEST_SCREENSHOT=/pfad/desktop.png`.

Die Testdiagnose `window.jellyfishTest` wird ausschließlich mit `?test=1`
angelegt. Der normale Anwendungseinstieg stellt sie nicht bereit.

### Ergänzende Prüfung auf echtem iPad/Safari

1. Preset wählen, Form/Farbe/Verhalten verändern und Kamera drehen.
2. Zwischen Hoch-/Querformat und Split View wechseln; Canvas und Regler prüfen.
3. Safari in den Hintergrund schicken, Gerät sperren, danach zurückkehren.
   Die Animation soll ohne Aufholsprung fortfahren.
4. `tests/browser.html` sichtbar ausführen und Ergebnisse prüfen.
5. PNG nach Wiederherstellung exportieren; bei längerer Laufzeit auf Thermik,
   Bildrate und die schrittweise Auflösungsanpassung achten.

Ausgeführte Prüfungen und verbleibende Geräteprüfungen: [VALIDATION.md](VALIDATION.md).
