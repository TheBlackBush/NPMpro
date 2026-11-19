## API-Zugriff

Alle API-Tokens aller Benutzer. Nur Administratoren sehen diese Seite.

Tokens werden von ihren Besitzern im Benutzermenü unter **API-Tokens** erstellt. Hier sehen Sie jedes Token mit Besitzer, Berechtigungen, Ablaufdatum, letzter Verwendung und Erstellungsdatum.

- **Widerrufen** stoppt ein Token sofort. Skripte und KI-Assistenten, die es verwenden, erhalten danach einen Authentifizierungsfehler.
- Ein Token hat nie mehr Berechtigungen als sein Besitzer. Das Token eines Administrators handelt nur mit eingeschaltetem Schalter **Administrator** als Administrator, und kein Token verwaltet Benutzer.
- Erstellen, Widerrufen, Ablauf und die erste Verwendung eines Tokens stehen im Audit-Log, mit dem Namen des Tokens neben dem Benutzer.

**API-Dokumentation** öffnet die API-Referenz aller Endpunkte in einem neuen Tab und zeigt den Header, in dem ein Token gesendet wird. **MCP-Server** zeigt den Endpunkt, die Einrichtung für Claude Code sowie für Claude Desktop und andere Clients und die Tools, die ein Token nutzen kann.
