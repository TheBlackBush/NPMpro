## Standardseite

Die Standardseite ist das, was nginx antwortet, wenn ein Besucher NPMpro mit einem Hostnamen erreicht, den kein Host verwendet, oder mit der IP-Adresse des Servers. Wählen Sie hier die Antwort. Sie gilt für alle unbekannten Namen.

Beim Speichern wird die neue Wahl zuerst mit nginx getestet. Schlägt der Test fehl, wird nichts gespeichert, die bisherige Standardseite bleibt, und der nginx-Fehler steht im Container-Log.

- **Glückwunschseite** (Standard): zeigt die Willkommensseite von NPMpro.
- **404-Seite**: antwortet mit einer Seite 404 Not Found.
- **Keine Antwort (444)**: schließt die Verbindung ohne jede Antwort. Verwenden Sie es, um Scannern nichts zu zeigen. HTTPS-Anfragen für unbekannte Namen werden beim TLS-Handshake abgewiesen.
- **Weiterleitung**: schickt Besucher mit einer temporären Weiterleitung (302) an eine andere Adresse. Geben Sie eine vollständige `http://`- oder `https://`-URL ein, ohne Leerzeichen, Anführungszeichen oder `; { } #`, bis zu 255 Zeichen.
- **Benutzerdefinierte HTML**: zeigt Ihre eigene HTML-Seite. Der **HTTP-Statuscode** darunter ist optional, von 400 bis 599. Lassen Sie ihn leer für 200 (OK).

Bei jeder Wahl außer Keine Antwort werden Anfragen an unbekannte Namen über einfaches HTTP zuerst auf HTTPS umgeleitet, und HTTPS-Anfragen verwenden das Zertifikat, das unter Einstellungen, Zertifikate & TLS als **Standardzertifikat** gewählt ist.

Dieser Abschnitt hat keine Umgebungsvariablen, die Änderung gilt also, sobald Sie speichern.
