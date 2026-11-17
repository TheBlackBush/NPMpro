## API-Zugriff

Alle API-Token aller Benutzer. Nur Administratoren sehen diese Seite.

Token werden von ihren Besitzern im Benutzermenü unter **API-Token** erstellt. Hier sehen Sie jeden Token mit Besitzer, Berechtigungen, Ablaufdatum, letzter Verwendung und Erstellungsdatum.

- **Widerrufen** stoppt einen Token sofort. Skripte und KI-Assistenten, die ihn verwenden, erhalten danach einen Authentifizierungsfehler.
- Ein Token hat nie mehr Berechtigungen als sein Besitzer. Der Token eines Administrators handelt nur mit eingeschaltetem Schalter **Administrator** als Administrator, und kein Token verwaltet Benutzer.
- Erstellen, Widerrufen, Ablauf und die erste Verwendung eines Tokens stehen im Audit-Log, mit dem Namen des Tokens neben dem Benutzer.

Die API-Dokumentation öffnet sich in einem neuen Tab.
