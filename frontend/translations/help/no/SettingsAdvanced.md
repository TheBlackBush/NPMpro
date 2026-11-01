## Avansert

Innstillinger som endrer hvordan NPMpro oppfører seg på små måter.

En variabel satt på containeren vinner over brukergrensesnittet og låser feltet (feltet viser et låsemerke som «Satt av TZ»). Bruk brukergrensesnittet for alt som ikke er satt i containeren.

- **Tidssone**: tidssonen til containeren. Den styrer klokkeslettene i logger, GoAccess-rapporten og planlagte jobber som planlagte sikkerhetskopier. Bruk et navn som `Europe/Berlin`. Standard: `UTC`. Variabel: `TZ`. Tas i bruk etter at containeren er startet på nytt: lagring lagrer verdien, og seksjonen lister den under «Start containeren på nytt for å ta i bruk».
- **Formater nginx-konfigurasjoner**: formaterer konfigurasjonene NPMpro skriver, med nginxbeautifier. Slå den av hvis den feiler på ikke-standard egendefinerte eller avanserte konfigurasjoner. Standard: på. Variabel: `DISABLE_NGINX_BEAUTIFIER` (invertert: `true` slår formatering av). Tas i bruk med en gang.
- **Gravatar-profilbilder**: viser Gravatar-bildet til brukere som ikke har lastet opp en avatar. For å hente et bilde sender NPMpro en hash av brukerens e-postadresse til Gravatar, så slå den av hvis det er viktig for deg. Standard: på. Variabel: `DISABLE_GRAVATAR` (invertert: `true` slår den av). Tas i bruk med en gang. Brukerens bilde endres ved neste lagring av profilen, og bilder som allerede er hentet blir stående til da.
