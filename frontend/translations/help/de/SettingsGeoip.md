## GeoIP

NPMpro lädt die kostenlosen MaxMind-GeoLite2-Datenbanken selbst herunter und schlägt Länder und Netzwerke auf Ihrem Server nach, sodass Besucher-IPs nie irgendwohin gesendet werden. Sie brauchen keinen separaten geoipupdate-Container. Die Datenbanken speisen die Karte und die Listen im Monitoring, GoAccess und die nginx-Länderregeln.

Eine am Container gesetzte Variable hat Vorrang vor der Oberfläche und sperrt das Feld (das Feld zeigt „Durch Umgebung gesetzt“). Verwenden Sie die Oberfläche für alles, was nicht im Container gesetzt ist. Das Speichern startet den Download im Hintergrund, und der Status unten wird aktualisiert, sobald er fertig ist.

### MaxMind-Konto

Sie brauchen ein kostenloses MaxMind-Konto und einen Lizenzschlüssel (in MaxMind: Account, Manage license keys). Auf der Seite gibt es einen Link zur Registrierung.

- **Konto-ID**: Variable `GEOIP_ACCOUNT_ID`.
- **Lizenzschlüssel**: verschlüsselt gespeichert und nie wieder angezeigt. Wenn der gespeicherte Schlüssel nicht entschlüsselt werden kann, geben Sie ihn erneut ein. Variable: `GEOIP_LICENSE_KEY`.

### Datenbanken

- **GeoLite2 Country**: Länder für die Karte, die Länderlisten und die nginx-Länderregeln. Standardmäßig an.
- **GeoLite2 ASN**: Netzwerke (AS-Nummer und Name) für die Netzwerklisten. Standardmäßig an.
- **GeoLite2 City**: optional, Städte für GoAccess. Ein deutlich größerer Download. Standardmäßig aus.

Variable: `GEOIP_EDITIONS`, durch Leerzeichen getrennt, zum Beispiel `GeoLite2-Country GeoLite2-ASN`. Ist keine Datenbank ausgewählt, wird nichts heruntergeladen oder aktualisiert, und bereits heruntergeladene Datenbanken bleiben erhalten.

### Status

Zeigt die letzte Aktualisierung und den letzten Fehler. NPMpro aktualisiert die Datenbanken, wenn Sie das Konto oder die Datenbanken ändern, wenn Sie auf **Jetzt aktualisieren** klicken und automatisch alle 3 Tage. Eine fehlgeschlagene automatische Aktualisierung wird nach 24 Stunden erneut versucht. **Jetzt aktualisieren** braucht eine gespeicherte Konto-ID und einen gespeicherten Lizenzschlüssel.

Ohne Datenbanken sind die Karte sowie die Länder- und Netzwerklisten ausgeblendet; der Rest funktioniert.

Mehr im Wiki: Monitoring.
