## Authentifizierung

Anmeldung an der NPMpro-Weboberfläche über einen OIDC-Anbieter (zum Beispiel Authentik, Keycloak oder Google), zusätzlich zu Passwörtern oder an deren Stelle. Das ist keine Forward-Authentifizierung: Es schützt Ihre Proxy-Hosts nicht. Dafür siehe Einstellungen, Forward-Authentifizierung.

Eine am Container gesetzte Variable hat Vorrang vor der Oberfläche und sperrt das Feld (das Feld zeigt „Durch Umgebung gesetzt“). Wenn alle vier Verbindungsvariablen gesetzt sind, ist OIDC aktiv, ohne dass es in der Oberfläche aktiviert wird. Verwenden Sie die Oberfläche für alles, was nicht im Container gesetzt ist. Alles hier gilt, sobald Sie speichern.

### Anbieter

- **OIDC-Anmeldung aktivieren**: zeigt den Anmeldebutton auf der Anmeldeseite.
- **Issuer-URL**: die Discovery-Basisadresse des Anbieters, zum Beispiel `https://accounts.example.com`. Variable: `OIDC_ISSUER_URL`.
- **Client-ID** und **Client-Secret**: von Ihrem Anbieter. Das Secret wird verschlüsselt gespeichert und nie wieder angezeigt; lassen Sie es leer, um es zu behalten. Wenn Sie die Issuer-URL oder die Client-ID ändern, geben Sie das Secret erneut ein. Variablen: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Weiterleitungsdomain**: die Domain, über die man NPMpro öffnet, mit dem Port, falls er nicht 443 ist. Erforderlich, weil daraus die Callback-URL gebildet wird. Variable: `OIDC_REDIRECT_DOMAIN`.
- **Callback-URL**: schreibgeschützt. Tragen Sie sie bei Ihrem Anbieter als Redirect-URI ein.
- **Scopes**: Standard `openid email profile`. Ändern Sie sie, wenn Ihr Anbieter nur einige erlaubt, zum Beispiel `openid email`.
- **Verbindung testen**: prüft, ob NPMpro den Issuer erreichen kann.

### Anmeldebutton

Der Button auf der Anmeldeseite: **Anzeigename** (der Text nach „Mit“ und vor „anmelden“), **Farbe** (eine Vorgabe oder Ihr eigenes `#rrggbb`) und **Symbol** (eingebaut, als PNG, JPEG, WebP oder SVG bis 256 KB hochgeladen oder von einer URL heruntergeladen). Eine Vorschau wird angezeigt.

### Anmelderegeln

- **Verifizierte E-Mail verlangen**: weist Benutzer ab, deren Anbieter die E-Mail-Adresse nicht verifiziert hat. Standard: an. Variable: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Zwei-Faktor nach OIDC überspringen**: vertraut der Multi-Faktor-Prüfung des Anbieters. Standard: aus. Variable: `OIDC_SKIP_MFA`.
- **Passwortanmeldung deaktivieren**: nur OIDC kann sich anmelden. Sie können es nur in einer Sitzung einschalten, die mit OIDC angemeldet wurde. Variable: `OIDC_DISABLE_PASSWORD`; um die Passwortanmeldung wiederherzustellen, setzen Sie sie auf `false` und erstellen Sie den Container neu.

### Neue Benutzer

- **Benutzer bei der ersten Anmeldung erstellen** (Standard: aus): Eine Person ohne Konto bekommt eines mit den unten genannten Berechtigungen.
- **Erlaubte E-Mail-Domains**: durch Kommas getrennt; leer erlaubt jede Domain. Bei leerer Liste und ohne verlangte verifizierte E-Mail bekommt jeder ein Konto, den Ihr Anbieter akzeptiert.
- **Standardberechtigungen für neue Benutzer**: pro Bereich festgelegt. Neue Benutzer sind nie Administratoren.

Mehr im Wiki: Authentication.
