# Prüfung der Stabilitätsänderungen

Stand: 12. Oktober 2026. Ausgangsbasis:
`29d2f62fdb15e412d06c0fba3b379a9bf94ff43c` auf `main`.

## Befunde im Ausgangscode

- Keine Behandlung von WebGL-Kontextverlust/-wiederherstellung.
- Unverwaltete RAF-Kette ohne explizite Hintergrundpause.
- Fester DPR-Deckel 2 ohne Pixelbudget oder Leistungsregelung.
- FPS aus dem auf 50 ms begrenzten Simulationsschritt: Werte unter 20 FPS
  konnten nicht korrekt angezeigt werden.
- Inline-Pixelgrößen am Canvas erschwerten Größen-/Orientierungswechsel.
- Framebuffer ohne Vollständigkeitsprüfung; Uniform-Lookups in jedem Frame.

Diese Befunde sind Codebefunde; daraus folgt kein Nachweis eines zuvor auf
Nutzerhardware beobachteten Absturzes. `pointcloud3/main/index.html` diente als
Referenz für die Kontext-Ereignisse. Dessen `location.reload()` wurde wegen des
möglichen Einstellungsverlusts nicht übernommen.

## Ausgeführte Prüfungen

- Node.js 24.19.0: **18 Tests bestanden**, keine ausgelassen.
- Headless Chrome 131.0.6778.204, Linux, SwiftShader: **55 Browserprüfungen
  bestanden** über fünf Viewport-/DPR-/CPU-Profile, keine ausgelassen.
- Pro Browserprofil: echte `WEBGL_lose_context`-Zyklen bei pausierter und laufender
  Seite, vollständiger CPU-Zustandsvergleich im pausierten Zustand, neue GPU-Handles,
  alle Presets/Bewegungsmodelle, drei Auflösungsbudgets, Resize, Fehler-/Retry-Pfad,
  PNG mit sichtbarem Szeneninhalt und abschließende Prüfung auf WebGL-Fehler.
- Die erwartete Framebuffer-Fehlermeldung wird im Fehlertest absichtlich ausgelöst.
- Visuelle Sichtprüfung eines Desktop-Screenshots: Quallengeometrie und bestehende
  Bedienoberfläche werden gerendert.
- `git diff --check` ohne Befund.

## Grenzen

Kein physisches iPad, Safari/WebKit oder Mac mini M4 in dieser Testumgebung.
Hintergrundereignisse sind in den automatisierten Tests synthetisch; echte
App-Wechsel, Sperrbildschirm, Safari-Tab-Verwerfung und langfristige Thermik
bleiben Geräteprüfungen. SwiftShader-Ergebnisse sind Funktionsnachweise, keine
Hardware-FPS-Messungen. Die Schritte dafür stehen in der README.
