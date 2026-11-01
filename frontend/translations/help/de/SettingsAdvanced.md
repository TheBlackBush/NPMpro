## Erweitert

Einstellungen, die das Verhalten von NPMpro in Kleinigkeiten ändern.

Eine am Container gesetzte Variable hat Vorrang vor der Oberfläche und sperrt das Feld (das Feld zeigt ein Schloss-Badge wie „Gesetzt durch TZ“). Verwenden Sie die Oberfläche für alles, was nicht im Container gesetzt ist.

- **Zeitzone**: die Zeitzone des Containers. Sie bestimmt die Zeiten in Logs, im GoAccess-Bericht und bei geplanten Aufgaben wie geplanten Sicherungen. Verwenden Sie einen Namen wie `Europe/Berlin`. Standard: `UTC`. Variable: `TZ`. Gilt nach einem Neustart des Containers: Speichern legt sie ab, und der Abschnitt listet sie unter „Starten Sie den Container neu, um anzuwenden“.
- **nginx-Konfigurationen formatieren**: formatiert die von NPMpro geschriebenen Konfigurationen mit nginxbeautifier. Schalten Sie es aus, wenn es bei nicht standardmäßigen eigenen oder erweiterten Konfigurationen fehlschlägt. Standard: an. Variable: `DISABLE_NGINX_BEAUTIFIER` (invertiert: `true` schaltet das Formatieren aus). Gilt sofort.
- **Gravatar-Profilbilder**: zeigt das Gravatar-Bild von Benutzern ohne hochgeladenen Avatar. Um ein Bild abzurufen, sendet NPMpro einen Hash der E-Mail-Adresse des Benutzers an Gravatar. Schalten Sie es daher aus, wenn Ihnen das wichtig ist. Standard: an. Variable: `DISABLE_GRAVATAR` (invertiert: `true` schaltet es aus). Gilt sofort; das Bild eines Benutzers ändert sich beim nächsten Speichern seines Profils, und bereits abgerufene Bilder bleiben bis dahin.
