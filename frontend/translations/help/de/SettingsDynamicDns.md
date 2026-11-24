## Dynamic DNS

Wie NPMpro die Einträge des Tabs Dynamic DNS (Zertifikate) auf seine öffentliche Adresse gerichtet hält. Es wird nichts geprüft, bis ein Eintrag aktiviert ist.

Eine auf dem Container gesetzte Variable hat Vorrang vor der Oberfläche und sperrt das Feld (das Feld zeigt ein Schloss-Abzeichen wie „Gesetzt durch DDNS_PERIOD“). Nutzen Sie die Oberfläche für alles, was nicht im Container gesetzt ist.

- **Prüfen alle**: wie oft die Einträge geprüft werden, von `1m` bis `24h` (zum Beispiel `5m` oder `1h30m`). Standard: `5m`. Variable: `DDNS_PERIOD`. Eine Änderung startet den Timer neu.
- **Abkühlzeit**: die kürzeste Zeit zwischen zwei Schreibvorgängen eines Eintrags, im selben Format. Standard: `5m`. Variable: `DDNS_COOLDOWN`.
- **IPv4-Adressdienste** und **IPv6-Adressdienste**: 2 bis 10 `https://`-URLs, die mit der öffentlichen Adresse antworten. Eine neue Adresse wird nur geschrieben, wenn ein zweiter Dienst sie bestätigt; eine unveränderte Adresse wird von einem Dienst übernommen. Die IPv6-Dienste werden nur gefragt, solange ein aktivierter Eintrag IPv6 braucht. Variablen: `DDNS_IPV4_SERVICES`, `DDNS_IPV6_SERVICES` (durch Leerzeichen getrennt). Ein Dienst auf diesem Host, auf einer Link-Local-Adresse (etwa Cloud-Metadaten) oder auf einer Multicast- oder reservierten Adresse wird abgelehnt; private LAN-Adressen sind erlaubt.
- **DNS-Server für Prüfungen**: nur für die Abfrage des Namens eines Eintrags, bevor der Anbieter gefragt wird (Split Horizon); die Adressdienste und die Anbieter verwenden immer die Resolver des Containers. Leer verwendet auch hier die Resolver des Containers. Eine IPv4-Adresse oder eine IPv6-Adresse in eckigen Klammern, mit optionalem Port. Variable: `DDNS_RESOLVER` (durch Leerzeichen getrennt).

Einträge werden im Tab Dynamic DNS mit den DNS-Zugangsdaten eines Anbieters hinzugefügt, der Einträge aktualisieren kann.
