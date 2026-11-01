## Zertifikate & TLS

Standardwerte für die Zertifikate, die NPMpro bei Ihrem ACME-Server anfordert (Let's Encrypt, sofern Sie mit `ACME_SERVER` keinen anderen setzen), dafür, wie sie gestapled und erneuert werden, und dafür, welches Zertifikat für unbekannte Hosts antwortet. Dies ist der Einstellungsbereich, nicht die Listenseite Zertifikate.

Eine am Container gesetzte Variable hat Vorrang vor der Oberfläche und sperrt das Feld (das Feld zeigt ein Schloss-Badge wie „Gesetzt durch ACME_KEY_TYPE“). Einige Felder folgen einem anderen: Ein alleiniges `ACME_KEY_SIZE`, das eine ECDSA-Kurve ist, hält den Schlüsseltyp auf ECDSA, und Must-Staple hält OCSP-Stapling an. Verwenden Sie die Oberfläche für alles, was nicht im Container gesetzt ist.

### Zertifikatsanforderungen

Diese gelten ab der nächsten Zertifikatsanforderung.

- **Schlüsseltyp**: `ECDSA` (Standard, empfohlen: kleinere Schlüssel, schnellere Handshakes) oder `RSA` für Clients, die ECDSA nicht nutzen können. Variable: `ACME_KEY_TYPE`.
- **Schlüsselgröße**: die Kurve für ECDSA (`secp256r1`, `secp384r1`, `secp521r1`; Standard `secp384r1`) oder die Bits für RSA (`2048`, `3072`, `4096`; Standard `4096`). Variable: `ACME_KEY_SIZE`.
- **ACME-Profil**: das beim Server angeforderte Profil, beim Speichern mit dem Server geprüft. Leer verwendet den Standard des Servers. Bei Let's Encrypt ist der Standard `shortlived`; Clients, die einen Common Name brauchen, funktionieren nicht mit `shortlived`- und `tlsserver`-Zertifikaten. Variable: `ACME_PROFILE` (`none` für leer).
- **OCSP Must-Staple**: markiert neue Zertifikate als Must-Staple und hält OCSP-Stapling an. Nur für CAs, die es unterstützen (ZeroSSL); Let's Encrypt lehnt solche Anforderungen ab. Standard: an für Google Trust Services und ZeroSSL, sonst aus. Variable: `ACME_MUST_STAPLE`.
- **Zertifikat des ACME-Servers prüfen**: Standard an. Schalten Sie es nur für einen privaten ACME-Server mit selbstsigniertem Zertifikat aus. Variable: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Beide gelten nach dem nginx-Reload, den das Speichern auslöst, und beide schalten die TLS-Zertifikatskomprimierung aus.

- **OCSP-Stapling für ACME-Zertifikate**: sendet die OCSP-Antwort mit Zertifikaten vom ACME-Server, wenn die CA OCSP anbietet. Standard: an für Google Trust Services und ZeroSSL, sonst aus. Variable: `ACME_OCSP_STAPLING`.
- **OCSP-Stapling für eigene Zertifikate**: dasselbe für hochgeladene Zertifikate. Standard: aus. Variable: `CUSTOM_OCSP_STAPLING`.

### Standardzertifikat

- **Zertifikat für unbekannte Hosts und die Weboberfläche**: wird für Hostnamen ausgeliefert, für die NPMpro keinen Host hat, und am Port der Weboberfläche. Standard: eingebaut, ein erzeugter Platzhalter. Variable: `DEFAULT_CERT_ID` (eine Zertifikats-ID; `0` ist eingebaut). Gilt nach dem nginx-Reload, den das Speichern auslöst.

### Erneuerung

- **Intervall der Erneuerungsprüfung**: 1 bis 499 Stunden zwischen den Prüfungen. Ein Zertifikat wird nur erneuert, wenn es fällig ist. Standard: 3. Variable: `CERTBOT_RUN_INTERVAL`. Gilt sofort.

### ECH

- **Rotationsintervall der ECH-Schlüssel**: 1 bis 24 Stunden zwischen den Läufen Ihres ECH-Skripts (`/data/tls/ech/cron.sh`). Wird nur verwendet, wenn das Skript nicht leer ist. Standard: 1. Variable: `ECH_ROTATION_INTERVAL`. Gilt sofort.

Mehr im Wiki: Security.
