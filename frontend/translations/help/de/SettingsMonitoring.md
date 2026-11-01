## Logs & Monitoring

Logdateien, der GoAccess-Logbericht und die Traffic-Statistiken hinter der Seite Monitoring.

Eine am Container gesetzte Variable hat Vorrang vor der Oberfläche und sperrt das Feld (das Feld zeigt ein Schloss-Badge wie „Gesetzt durch LOGROTATE“ oder bei den Statistiken „Durch Umgebung gesetzt“). Verwenden Sie die Oberfläche für alles, was nicht im Container gesetzt ist. Einstellungen mit „Neustart erforderlich“ werden sofort gespeichert, aber erst beim Start des Containers gelesen; der Abschnitt listet sie dann unter „Starten Sie den Container neu, um anzuwenden“.

### Logdateien

- **Logdateien schreiben**: schreibt die nginx-Fehler-, Stream- und Zugriffslogs nach `/data/nginx/logs` und rotiert sie täglich. Standard: aus. Variable: `LOGROTATE`. Gilt nach dem nginx-Reload, den das Speichern auslöst. Bleibt an, solange GoAccess läuft.
- **Aufbewahrte Logrotationen**: wie viele rotierte Logdateien aufbewahrt werden, bevor die älteste gelöscht wird, 1 bis 1000. Standard: 3. Variable: `LOGROTATIONS`. Gilt sofort.

### GoAccess

- **GoAccess-Bericht**: startet GoAccess, einen Weblog-Bericht für Administratoren, unter `/goaccess` der Weboberfläche. Standard: aus. Variable: `GOA`. Gilt nach einem Neustart des Containers. Er schaltet die Traffic-Statistiken nicht ein.

Bei eingeschaltetem Bericht erscheinen diese Optionen. Alle gelten nach einem Neustart des Containers. Eine einzige Variable, `GOACLA`, ersetzt sie alle durch Ihre eigenen GoAccess-Optionen und sperrt sie.

- **Berichtsdaten behalten**: 1 bis 366 Tage. Standard: 30.
- **Besucher-IPs anonymisieren**: Aus, Stufe 1 (Standard), Stufe 2 (stark) oder Stufe 3 (sehr streng). Stufe 1 verbirgt das letzte IPv4-Byte (die letzten 64 Bit bei IPv6), Stufe 2 zwei Bytes (80 Bit), Stufe 3 drei Bytes (96 Bit).
- **Query-Strings entfernen**: entfernt Query-Strings aus den URLs im Bericht, sodass Tokens in URLs nicht gespeichert werden. Standard: an.
- **Vollständige Betriebssystemversionen**: zeigt die vollständige Version, nicht nur die Familie. Standard: an.
- **Hostnamen auflösen**: schlägt Hostnamen von Besucher-IPs nach. Dabei werden DNS-Anfragen dafür gesendet. Standard: an.

### Monitoring

Diese steuern den Tab Datenverkehr der Seite Monitoring. Alle gelten sofort beim Speichern. Variablen: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Traffic-Statistiken**: liest das nginx-Zugriffslog und zählt Anfragen pro Host, Status, Land und Netzwerk. Standard: aus. Das Ausschalten stoppt das neue Zählen; gespeicherte Statistiken bleiben, bis sie veralten, außer Sie haken im Dialog „Auch die gespeicherten Statistiken löschen“ an.
- **Statistiken behalten für**: 7 bis 365 Tage. Standard: 30. Daten pro Minute werden 24 Stunden aufbewahrt, Daten pro Stunde so viele Tage.
- **Besucher-IPs anzeigen**: speichert Besucher-IPs pro Stunde, um die häufigsten IPs aufzulisten. Standard: aus, aus Datenschutzgründen. Das Ausschalten löscht die gespeicherten IPs.
- **Eindeutige Besucher zählen**: speichert pro Host und Tag einen Hash mit Schlüssel jeder Besucher-IP, um eindeutige Besucher zu zählen. Standard: aus. Das Ausschalten löscht die Hashes.
- **Besucherlimit pro Host und Tag**: 1000 bis 1000000. Standard: 100000. Ein Host, der es erreicht, zählt an diesem Tag keine neuen Besucher mehr und zeigt ein Pluszeichen.

Länder und Netzwerke brauchen die GeoIP-Datenbanken (Einstellungen, GeoIP).

Mehr im Wiki: Monitoring.
