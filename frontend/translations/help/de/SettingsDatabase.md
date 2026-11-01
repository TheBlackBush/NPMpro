## Datenbank

Die Datenbank, in der NPMpro seine Hosts, Zertifikate, Benutzer, Logs und Statistiken ablegt. Standardmäßig ist das SQLite, eine einzelne Datei, und das ist die empfohlene Wahl. Von hier aus können Sie alles nach MySQL, MariaDB, PostgreSQL oder in eine neue SQLite-Datei verschieben. Die verwendete Datenbank wird durch einen Umzug nicht verändert.

### Verwendete Datenbank

Zeigt das Datenbanksystem und die Version, wo es liegt, die Größe und die **Quelle** der Verbindung: **Standard** (die SQLite-Datei `/data/npmpro/database.sqlite`), **Datei mit Datenbankeinstellungen** (`/data/npmpro/database.json`, von einem Umzug geschrieben) oder **Umgebung** (`DB_MYSQL_*`- oder `DB_POSTGRES_*`-Variablen). Nach einem Umzug steht dort, wann und von welchem System Sie umgezogen sind.

### Tabellen

Jede Tabelle mit ihren Zeilen und ihrer Größe. Die Karte lässt sich einklappen.

### In eine andere Datenbank verschieben

Legen Sie zuerst auf Ihrem Server eine leere Datenbank und einen Benutzer an, der Tabellen erstellen darf; NPMpro erstellt die Datenbank nicht. Voraussetzungen: MySQL 8.0, MariaDB 10.6 oder PostgreSQL 13 oder neuer.

1. Wählen Sie das **Datenbanksystem** und geben Sie **Host**, **Port**, **Datenbankname**, **Benutzer** und **Passwort** ein. Schalten Sie **TLS verwenden** ein, wenn der Server es braucht (bei MySQL und MariaDB können Sie außerdem **Serverzertifikat prüfen** und **Servernamen prüfen**). Ein Umzug nach SQLite braucht nichts: Er erstellt eine neue Datei in `/data/npmpro`.
2. **Verbindung testen**. Das prüft die Version, dass die Datenbank leer ist und dass der Benutzer Tabellen erstellen kann. Es ändert nichts.
3. **Verschieben**, dann das verlangte Wort eintippen und auf **Jetzt verschieben** klicken.

NPMpro pausiert Änderungen, erstellt eine Sicherheitssicherung, legt die Tabellen an, kopiert und prüft jede Zeile und startet dann auf der neuen Datenbank neu. Ihre Seiten werden weiter ausgeliefert. Die Seite lädt neu, sobald NPMpro wieder antwortet, und Sie müssen sich eventuell neu anmelden.

Wenn ein Schritt fehlschlägt, bleibt NPMpro bei der bisherigen Datenbank, und das Fenster nennt den Schritt, der gestoppt hat. Die alte Datenbank wird nie gelöscht, Sie können also zurück: Entfernen Sie `/data/npmpro/database.json` und starten Sie den Container neu.

Wenn die Verbindung aus `DB_MYSQL_*`- oder `DB_POSTGRES_*`-Variablen kommt, ist der Abschnitt schreibgeschützt. Zum Umziehen erstellen Sie eine Sicherung, richten die Variablen auf die neue Datenbank, starten neu und stellen die Sicherung wieder her.

Mehr im Wiki: Database.
