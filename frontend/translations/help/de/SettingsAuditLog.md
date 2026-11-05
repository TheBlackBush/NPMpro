## Audit-Logs

Ein Protokoll darüber, wer was geändert hat. Nur Administratoren sehen es.

Jeder Eintrag zeigt den Benutzer, das Objekt und die Aktion. Protokolliert werden:

- **Erstellt**, **Aktualisiert** und **Gelöscht** für Proxy-Hosts, Weiterleitungs-Hosts, 404-Hosts, Streams, Zugriffslisten, Zertifikate, DNS-Zugangsdaten, Backup-Zeitpläne und Benutzer. Einstellungen protokollieren nur **Aktualisiert**.
- **Aktiviert** und **Deaktiviert** für Proxy-Hosts, Weiterleitungs-Hosts, 404-Hosts, Streams und Backup-Zeitpläne.
- Sicherungen: **Erstellt**, **Hochgeladen**, **Gelöscht**, **Wiederhergestellt** und **Zusammengeführt** für eine Sicherung sowie **Sicherung erfolgreich** und **Sicherung fehlgeschlagen** bei geplanten Sicherungsläufen.
- **Heruntergeladen** für Zertifikate. **Exportiert** und **Importiert** für die Sicherung einer einzelnen Seite (Hosts, Zugriffslisten, Zertifikate, DNS-Zugangsdaten).
- Datenbankumzüge: **Verschoben** und **Verschieben fehlgeschlagen**.

Die neuesten Einträge stehen oben. **Mehr laden** zeigt die nächsten 50, und die Zahl unter der Liste nennt, wie viele der insgesamt vorhandenen geladen sind.

### Einen Eintrag finden

- **Suchen** durchsucht die Details aller Einträge, ein Domainname oder eine E-Mail-Adresse findet also die zugehörigen Einträge.
- **Objekttyp**, **Aktion** und **Benutzer** schränken die Liste ein. Sie lassen sich miteinander und mit der Suche kombinieren.
- Bei aktivem Filter oder aktiver Suche nennt die Liste, wie viele Einträge angezeigt werden. **Filter zurücksetzen** entfernt alle.

### Details

Der Augen-Button einer Zeile (**Details anzeigen**) öffnet den Eintrag: den Benutzer, was geschehen ist und die dazu gespeicherten Daten. Bei einer Änderung ist das das Objekt, wie es gespeichert wurde. Lange Werte werden umbrochen, und das Fenster lässt sich scrollen.

Ein inzwischen gelöschter Benutzer erscheint als **Gelöschtes Konto**. NPMpro entfernt Einträge nie von selbst, und das Audit-Log ist nicht Teil einer Sicherung.

Mehr im Wiki: Usage (Audit Logs).
