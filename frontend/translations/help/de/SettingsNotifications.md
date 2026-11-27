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

### Einladungen und Kontohinweise

Beides braucht einen Mailserver. Einladungen brauchen außerdem die **Öffentliche URL**.

- **Einladungen**: Beim Anlegen eines Benutzers können Sie eine Einladung senden, statt ein Passwort festzulegen. Der Benutzer erhält eine Mail mit einem Link zum Wählen eines Passworts; der Link funktioniert einmal und 72 Stunden lang. **Einladung erneut senden** in der Benutzerliste sendet einen neuen Link.
- **Kontohinweise**: Benutzer erhalten eine Mail, wenn sich ihr Passwort oder ihre Adresse ändert, die Zwei-Faktor-Anmeldung ausgeschaltet wird oder neue Backup-Codes erstellt werden.

### Webhooks

Ein Webhook ist eine eigene Adresse, die NPMpro mit einer signierten HTTP-Anfrage aufruft, wenn etwas passiert, zum Beispiel wenn ein Zertifikat erneuert wurde. Nur Administratoren sehen diese Karte.

- **URL**: `https://` zu jedem öffentlichen Host oder `http://` zu einer Adresse in Ihrem lokalen Netzwerk. Weiterleitungen werden nicht verfolgt. Die Adresse wird verschlüsselt gespeichert und nie wieder angezeigt; lassen Sie das Feld beim Bearbeiten leer, um sie zu behalten.
- **Ereignisse**: Wählen Sie die zu sendenden Ereignisse oder **Alle Ereignisse**.
- **Signaturgeheimnis**: wird nach dem Speichern einmal angezeigt. Bewahren Sie es dort auf, wo Ihr Empfänger es liest. **Geheimnis erneuern** erzeugt ein neues; das alte signiert noch 24 Stunden weiter, damit Ihr Empfänger umstellen kann.
- **Test senden**: sendet sofort ein Testereignis und zeigt Status und Dauer. Es erscheint nicht unter Zustellungen.
- **Zustellungen**: die neuesten Ereignisse des Webhooks mit Status, Versuchen und der Antwort des Empfängers. **Erneut zustellen** sendet eine fehlgeschlagene Zustellung noch einmal, bis 7 Tage nach dem Fehlschlag.
- Eine fehlgeschlagene Anfrage wird bis zu 8 Mal in etwa 41 Stunden wiederholt. Ein Webhook wird ausgeschaltet, wenn der Empfänger mit 410 Gone antwortet oder wenn er nach 3 Tagen Fehlschlägen ohne Erfolg erneut fehlschlägt. Ein ausgeschalteter Webhook zeigt den Grund; schalten Sie ihn ein, um ihn wieder zu verwenden.
- Prüfen Sie jede Anfrage mit einer beliebigen Standard-Webhooks-Bibliothek, mit dem unveränderten Body und der `webhook-id` als Schlüssel gegen doppelte Verarbeitung.

Mehr im Wiki: Configuration.
