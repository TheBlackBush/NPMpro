## CrowdSec

Verbindet den in NPMpro eingebauten CrowdSec-Bouncer mit Ihrem CrowdSec-Container. Jede Anfrage an Ihre Hosts wird anhand der Entscheidungen der CrowdSec Local API (LAPI) geprüft und, mit einer AppSec-URL, zusätzlich anhand der AppSec-Regeln. Beim Speichern werden die Einstellungen sofort mit einem nginx-Reload übernommen; der Container wird nicht neu gestartet.

NPMpro schreibt `/data/crowdsec/crowdsec.conf` aus diesen Einstellungen. Manuelle Änderungen an dieser Datei werden überschrieben. `ban.html` und `captcha.html` im selben Ordner können Sie selbst bearbeiten.

Eine am Container gesetzte Variable hat Vorrang vor der Oberfläche und sperrt das Feld: `CROWDSEC_ENABLED`, `CROWDSEC_LAPI_URL`, `CROWDSEC_API_KEY`, `CROWDSEC_APPSEC_URL`.

### Status und Verbindung testen

Zeigt, ob nginx den Bouncer lädt und wann NPMpro die LAPI zuletzt erreicht hat. **Verbindung testen** prüft die Werte im Formular: eine Entscheidungsanfrage an die LAPI mit dem Schlüssel (oder dem TLS-Clientzertifikat) und, mit einer AppSec-URL, eine Anfrage an AppSec. Ein leeres Schlüsselfeld verwendet den gespeicherten Schlüssel.

Beim Speichern mit eingeschaltetem Bouncer läuft zuerst derselbe Test. Schlägt er fehl, werden die Gründe angezeigt, und **Trotzdem speichern** speichert dennoch, zum Beispiel wenn CrowdSec noch nicht läuft.

**Trotzdem speichern** wird nicht angeboten, wenn AppSec fehlschlägt, **Wenn AppSec nicht erreichbar ist** auf **Anfrage verweigern** steht und die Admin-Oberfläche geprüft wird, denn dieses Speichern würde Sie aus der Admin-Oberfläche aussperren: Korrigieren Sie den **API-Schlüssel** oder die **AppSec-URL**, stellen Sie die Ausfallaktion auf **Anfrage durchlassen** oder schalten Sie **Admin-Oberfläche von CrowdSec ausnehmen** ein.

### Verbindung

- **Bouncer aktivieren**: prüft jede Anfrage.
- **LAPI-URL**: zum Beispiel `http://127.0.0.1:8080`.
- **API-Schlüssel**: aus `docker exec crowdsec cscli bouncers add npmpro`. Verschlüsselt gespeichert, nie wieder angezeigt. **Gespeicherten Schlüssel entfernen** löscht ihn.
- **TLS-Clientzertifikat**: anstelle des Schlüssels eine Zertifikats- und eine Schlüsseldatei unter `/data/crowdsec/`; erfordert eine LAPI-URL mit `https://`. Sobald eine AppSec-URL gesetzt ist, wird das Feld **API-Schlüssel** auch mit einem TLS-Clientzertifikat angezeigt und ist erforderlich, weil AppSec sich mit dem API-Schlüssel authentifiziert; ohne ihn lehnt AppSec jede Anfrage ab.
- **TLS-Zertifikate prüfen**: prüft das Zertifikat einer https-LAPI- oder AppSec-URL.

### Blockierung

- **Modus**: Live fragt die LAPI pro Client-IP ab und speichert die Antwort für die angegebenen Sekunden zwischen; Stream lädt alle Entscheidungen im angegebenen Intervall herunter.
- **Antwort auf eine Sperre**: die Sperrseite (mit optionalem Statuscode, standardmäßig 403), eine Weiterleitung oder ein Statuscode ohne Seite.
- **Ersatzmaßnahme** und **Entscheidungstypen**: wie Entscheidungen behandelt werden, die der Bouncer nicht anwenden kann, und welche Typen durchgesetzt werden.
- **Admin-Oberfläche von CrowdSec ausnehmen**: Anfragen an die Admin-Oberfläche umgehen Bouncer und AppSec. Schalten Sie es ein, bevor Sie AppSec mit Verweigern verwenden, damit ein CrowdSec-Ausfall Sie nicht aussperren kann.

### Captcha

Der Anbieter (reCAPTCHA, hCaptcha, Cloudflare Turnstile), sein Site-Key und geheimer Schlüssel sowie wie lange ein gelöstes Captcha gültig bleibt. Wird für Entscheidungen vom Typ Captcha verwendet.

### AppSec

- **AppSec-URL**: zum Beispiel `http://127.0.0.1:7422`; leer schaltet AppSec aus.
- **Wenn AppSec nicht erreichbar ist**: Verweigern blockiert jede geprüfte Anfrage, solange AppSec nicht erreichbar ist; Durchlassen lässt sie ungeprüft passieren.

### Erweitert

Das Timeout für LAPI-Anfragen, Szenariofilter, ausgeschlossene Pfade, interne Anfragen, die AppSec-Timeouts und -Optionen sowie die Dateien der Sperr- und Captcha-Seiten mit einer **Vorschau**.

### Ausgesperrt?

Starten Sie CrowdSec erneut oder setzen Sie `CROWDSEC_ENABLED=false` am Container und erstellen Sie ihn neu; korrigieren Sie danach die Einstellungen hier.

Mehr im Wiki: CrowdSec.
