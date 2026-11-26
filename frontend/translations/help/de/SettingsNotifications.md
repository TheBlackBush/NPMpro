## Benachrichtigungen

NPMpro sendet Mails über einen SMTP-Server Ihrer Wahl. Mail wird jetzt für die Testmail verwendet, später für das Zurücksetzen von Passwörtern und für Warnungen. Die Einstellungen hier können auch aus Container-Variablen kommen: Eine am Container gesetzte Variable hat Vorrang vor der Oberfläche und sperrt ihr Feld (das Feld zeigt "Durch Umgebung gesetzt"). Nutzen Sie die Oberfläche für alles, was nicht im Container gesetzt ist.

### Mailserver

Jede Verbindung wird wie andere ausgehende Anfragen geprüft: Der Servername muss sich auflösen lassen, lokale und Link-Local-Adressen werden abgelehnt. Mail gilt als eingerichtet, wenn Host und Absenderadresse ausgefüllt sind.

- **Host** und **Port**: der SMTP-Server. Variablen: `SMTP_HOST`, `SMTP_PORT` (Standard 587).
- **Sicherheit**: **STARTTLS** stuft eine unverschlüsselte Verbindung hoch (meist Port 587), **TLS** ist von Anfang an verschlüsselt (meist Port 465), **Keine** sendet ohne Verschlüsselung. Variable: `SMTP_SECURITY` (`starttls`, `tls` oder `none`).
- **Zertifikat prüfen**: lehnt einen Server ab, dessen Zertifikat nicht gültig ist. Variable: `SMTP_VERIFY_TLS` (`false` schaltet es aus).
- **Benutzer** und **Passwort**: die Anmeldung. Das Passwort wird verschlüsselt gespeichert und nie wieder angezeigt; **Entfernen** löscht es, und wenn das gespeicherte nicht entschlüsselt werden kann, geben Sie es erneut ein. Variablen: `SMTP_USERNAME`, `SMTP_PASSWORD`.
- **Absendername** und **Absenderadresse**: wie Mails von NPMpro erscheinen. Variablen: `SMTP_FROM_NAME`, `SMTP_FROM`.
- **Antwortadresse**: wohin Antworten gehen; leer verwendet die Absenderadresse. Variable: `SMTP_REPLY_TO`.

Bei Sicherheit **Keine** und einem Benutzer würde das Passwort unverschlüsselt übertragen, daher ist das nur für einen Server in Ihrem lokalen Netzwerk erlaubt.

**Testmail senden** sendet eine Mail mit den gespeicherten Einstellungen an die eingegebene Adresse (standardmäßig Ihre) und zeigt die Antwort des Servers, wenn es fehlschlägt. Speichern Sie zuerst: Die Schaltfläche ist deaktiviert, solange das Formular ungespeicherte Änderungen hat, und ausgeblendet, bis Mail eingerichtet ist.

### Alarmmails

Wird angezeigt, sobald ein Mailserver eingerichtet ist. Mails über Probleme, die NPMpro erkennt, und darüber, wann sie behoben sind; ein Problem, das offen bleibt, wird wiederholt.

- **An Administratoren senden**: Jeder aktivierte Administrator mit einer gültigen Adresse erhält die Alarme.
- **Zusätzlich senden an**: weitere Adressen, höchstens 20, zum Beispiel eine Team-Liste. Eine abgelehnte Adresse wird an ihrem Chip markiert. Variable: `ALERT_ADDRESSES` (durch Kommas getrennt).
- **Ereignisse**: Haken Sie die Probleme an, über die Sie Mails möchten, nach Bereichen gruppiert. Wer eines anhakt, erhält auch die Mail zu seiner Behebung.
- **Erinnern alle (Stunden)**: wie lange ein Problem ruhig bleibt, bevor es erneut gemailt wird; 0 wiederholt es nie, höchstens 168.

**Beispiel senden** schickt sofort einen Beispielalarm mit den gespeicherten Einstellungen an alle, die Alarme erhalten würden. Speichern Sie zuerst: Die Schaltfläche ist deaktiviert, solange das Formular ungespeicherte Änderungen hat. Schlägt ein Versand fehl, nennt die Meldung die Adresse.

### Links und Sprache

- **Öffentliche URL**: die Adresse, unter der Personen NPMpro öffnen, für die Links in Mails, zum Beispiel `https://npm.example.com`. Nur HTTPS, kein Pfad. **Adresse dieses Browsers verwenden** trägt die Adresse dieser Seite ein, wenn sie über HTTPS geöffnet ist. Variable: `PUBLIC_URL`.
- **Standardsprache für Mails**: die Sprache der Mails für Personen, die keine gewählt haben. Die Oberflächensprache jedes Benutzers wird gemerkt und für seine Mails verwendet. Variable: `MAIL_LANGUAGE`.

Mehr im Wiki: Configuration.
