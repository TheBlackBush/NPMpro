## Geavanceerd

Instellingen die het gedrag van NPMpro op kleine punten veranderen.

Een variabele die op de container is gezet, gaat voor op de interface en vergrendelt het veld (het veld toont een slotbadge zoals „Ingesteld door TZ”). Gebruik de interface voor alles wat niet in de container is ingesteld.

- **Tijdzone**: de tijdzone van de container. Ze bepaalt de tijden in logs, het GoAccess-rapport en geplande taken zoals geplande back-ups. Gebruik een naam als `Europe/Berlin`. Standaard: `UTC`. Variabele: `TZ`. Geldt na een herstart van de container: opslaan bewaart haar, en de sectie noemt haar onder „Herstart de container om toe te passen”.
- **nginx-configuraties opmaken**: maakt de configuraties die NPMpro schrijft op met nginxbeautifier. Zet het uit als het mislukt bij niet-standaard eigen of geavanceerde configuraties. Standaard: aan. Variabele: `DISABLE_NGINX_BEAUTIFIER` (omgekeerd: `true` zet het opmaken uit). Geldt direct.
- **Gravatar-profielfoto's**: toont de Gravatar-foto van gebruikers zonder geüploade avatar. Om een foto op te halen stuurt NPMpro een hash van het e-mailadres van de gebruiker naar Gravatar, dus zet het uit als dat voor u telt. Standaard: aan. Variabele: `DISABLE_GRAVATAR` (omgekeerd: `true` zet het uit). Geldt direct; de foto van een gebruiker verandert bij het volgende opslaan van zijn profiel, en al opgehaalde foto's blijven tot dan.
