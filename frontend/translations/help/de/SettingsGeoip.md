## GeoIP

NPMpro lädt kostenlose GeoIP-Datenbanken (DB-IP Lite oder MaxMind GeoLite2) selbst herunter und schlägt Länder und Netzwerke auf Ihrem Server nach, sodass Besucher-IPs nie irgendwohin gesendet werden. Sie brauchen keinen separaten geoipupdate-Container. Die Datenbanken speisen die Karte und die Listen im Monitoring, GoAccess und die nginx-Länderregeln.

Eine am Container gesetzte Variable hat Vorrang vor der Oberfläche und sperrt das Feld (das Feld zeigt „Durch Umgebung gesetzt“). Verwenden Sie die Oberfläche für alles, was nicht im Container gesetzt ist. Das Speichern startet den Download im Hintergrund, und der Status unten wird aktualisiert, sobald er fertig ist.

### Anbieter

- **DB-IP Lite** ist der Standard: kostenlos, kein Konto nötig, jeden Monat neue Dateien (NPMpro prüft einmal pro Woche).
- **MaxMind GeoLite2** bleibt erhalten: Es braucht ein kostenloses Konto und einen Lizenzschlüssel und wird zweimal pro Woche aktualisiert.

Es ist immer ein Anbieter aktiv, und nur dessen Datenbanken werden verwendet. Die Dateien des anderen Anbieters bleiben auf der Festplatte, sodass beim Zurückwechseln kein neuer Download nötig ist. GoAccess übernimmt einen Wechsel beim nächsten Containerstart. Variable: `GEOIP_PROVIDER` (`dbip` oder `maxmind`).

### DB-IP-Datenbanken

- **Country**: Länder für die Karte, die Länderlisten und die Länderregeln der Zugriffslisten.
- **ASN**: Netzwerke (AS-Nummer und Name) für die Netzwerklisten.

Beide sind standardmäßig an. Variable: `GEOIP_DBIP_EDITIONS`.

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

Zeigt die letzte Aktualisierung, die letzte Prüfung und den letzten Fehler. NPMpro aktualisiert die Datenbanken des aktiven Anbieters, wenn Sie den Anbieter, das Konto oder die Datenbanken ändern, wenn Sie auf **Jetzt aktualisieren** klicken und automatisch: MaxMind alle 3 Tage, DB-IP alle 7 Tage (DB-IP veröffentlicht monatlich neue Dateien, und nur eine neuere Datei wird heruntergeladen). Eine fehlgeschlagene automatische Aktualisierung wird nach 24 Stunden erneut versucht. Bei MaxMind braucht **Jetzt aktualisieren** eine gespeicherte Konto-ID und einen gespeicherten Lizenzschlüssel, bei DB-IP mindestens eine ausgewählte Datenbank.

Ohne Datenbanken sind die Karte sowie die Länder- und Netzwerklisten ausgeblendet; der Rest funktioniert.

Mehr im Wiki: Monitoring.
