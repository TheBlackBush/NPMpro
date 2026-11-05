## Benutzer

Die Personen, die sich an diesem NPMpro anmelden können. Nur Administratoren sehen diese Liste. Personen können sich auch über einen OIDC-Anbieter anmelden, einzurichten unter Einstellungen, Authentifizierung.

Die Liste zeigt Name, E-Mail, Rollen und Status jedes Benutzers. Suchen Sie nach Name oder E-Mail und sortieren Sie nach einer Spalte.

### Benutzer hinzufügen oder bearbeiten

**Benutzer hinzufügen** fragt nach **Name** und **E-Mail-Adresse**. Bearbeiten öffnet dasselbe Fenster, in dem Sie auch den Avatar des Benutzers hochladen oder entfernen können. Unter **Optionen**:

- **Administrator**: voller Zugriff, auch auf Einstellungen, Benutzer und Audit-Logs. Ohne diese Option ist der Benutzer ein Standardbenutzer, begrenzt durch die Berechtigungen unten.
- **Deaktiviert**: der Benutzer kann sich nicht mehr anmelden, und seine offenen Sitzungen enden.

Sie können weder Ihre eigenen Rollen ändern noch sich selbst deaktivieren oder löschen, und Ihre eigene Zeile bietet nur Bearbeiten.

### Zeilenmenü

Für die anderen Konten:

- **Berechtigungen**: siehe unten.
- **Passwort setzen**: legt ein neues Passwort fest. Alle anderen Geräte dieses Benutzers werden abgemeldet.
- **MFA zurücksetzen**: nur für Benutzer mit MFA. Es schaltet MFA ohne Wiederherstellungscode aus, und der Benutzer kann es erneut einrichten.
- **Sitzungen widerrufen**: meldet den Benutzer auf allen Geräten ab.
- **Deaktivieren** oder **Aktivieren**: dasselbe wie die Option **Deaktiviert**.
- **Löschen**: entfernt das Konto. Seine Einträge in den Audit-Logs bleiben erhalten.

### Berechtigungen

Für einen Standardbenutzer wählen Sie pro Bereich (Proxy-Hosts, Weiterleitungs-Hosts, 404-Hosts, Streams, Zugriffslisten, Zertifikate): **Verwalten**, **Nur anzeigen** oder **Versteckt**. **Objektsichtbarkeit** legt fest, ob der Benutzer **Alle Elemente** oder **Nur erstellte Elemente** sieht.

Eine Auswahl schaltet auch ein, was der Bereich braucht: Proxy-Hosts brauchen Zugriffslisten und Zertifikate, und Versteckt ist nicht wählbar, solange ein anderer Bereich diesen braucht. Administratoren haben Zugriff auf alles, für sie wird daher nur die Objektsichtbarkeit angeboten.

Mehr im Wiki: Usage (Users and permissions) und Authentication.
