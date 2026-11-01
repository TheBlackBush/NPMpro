## Sichern und Wiederherstellen

Speichern Sie Ihre Hosts, Zertifikate, Benutzer und Einstellungen in einer `.npmpro`-Datei und stellen Sie sie auf dieser oder einer anderen NPMpro-Instanz wieder her. Traffic-Statistiken und Logs sind nie Teil einer Sicherung.

### Sicherung erstellen

- **Was enthalten sein soll**: Teile wie Hosts, Zugriffslisten, Zertifikate, DNS-Zugangsdaten, Benutzer, Einstellungen und eigene Dateien. Zu Beginn sind alle angehakt.
- **Geheimnisse einschließen**: fügt private Schlüssel, Passwörter, Zwei-Faktor-Geheimnisse, DNS-Zugangsdaten, das OIDC-Client-Secret und den GeoIP-Lizenzschlüssel hinzu. Die Datei wird mit einer **Passphrase** von mindestens 12 Zeichen verschlüsselt, die Sie zweimal eingeben. NPMpro speichert sie nicht, ohne sie lässt sich die Sicherung also nicht wiederherstellen.
- Ohne Geheimnisse ist die Datei nicht verschlüsselt und lässt die Geheimnisse weg. Sie enthält trotzdem Hostnamen, Benutzer und Einstellungen, halten Sie sie also privat.
- **Herunterladen** speichert die Datei auf Ihrem Computer. **Auf dem Server behalten** legt sie in `/data/backups` ab.

### Geplante Sicherungen

Fügen Sie Zeitpläne hinzu, die Sicherungen selbst erstellen und auf dem Server ablegen.

- **Wann**: alle N Stunden, täglich, wöchentlich oder monatlich, in der Zeitzone des Containers.
- **Schutz**: **Passphrase** (überall wiederherstellbar), **Instanzschlüssel** (nichts zu merken, nur auf dieser Instanz wiederherstellbar) oder **Ohne Geheimnisse**.
- **Behalten**: wie viele Dateien dieses Zeitplans behalten werden. Ältere werden nach jedem erfolgreichen Lauf gelöscht.
- Ein Zeitplan kann sofort ausgeführt, pausiert, bearbeitet oder gelöscht werden. Ein fehlgeschlagener Lauf wird am Zeitplan und im Dashboard angezeigt.

Geplante Sicherungen schützen Sie vor fehlerhaften Änderungen, nicht vor dem Verlust des Datenträgers. Kopieren Sie die Dateien dafür auf einen anderen Rechner.

### Gespeicherte Sicherungen

Listet die Dateien auf dem Server. Laden Sie sie herunter, stellen Sie sie wieder her oder löschen Sie sie, oder wählen Sie **Sicherung hochladen**. NPMpro erstellt vor jeder Wiederherstellung, jedem Zusammenführen und jedem Datenbankumzug eine Sicherung mit der Bezeichnung **Automatisch**; sie braucht keine Passphrase und lässt sich nur auf dieser Instanz wiederherstellen.

### Wiederherstellen

- **Ersetzen** tauscht die gewählten Teile auf dieser Instanz gegen die der Sicherung aus. Ihr eigenes Konto wird nie ersetzt.
- **Zusammenführen** fügt die Einträge der Sicherung hinzu und löscht nichts. Es zeigt eine Vorschau und lässt Sie bei jedem Konflikt wählen: überspringen, den vorhandenen Eintrag verwenden, als neu hinzufügen oder ersetzen.

Eine Wiederherstellung wird zurückgerollt, wenn nginx das Ergebnis ablehnt. Eine Sicherung aus einer neueren NPMpro-Version lässt sich nicht wiederherstellen. Einige wiederhergestellte Einstellungen brauchen einen Neustart des Containers.

Dieser Abschnitt hat keine Umgebungsvariablen.

Mehr im Wiki: Backup-and-restore.
