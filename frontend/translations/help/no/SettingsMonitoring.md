## Logger og overvåking

Loggfiler, GoAccess-loggrapporten og trafikkstatistikken bak Overvåking-siden.

En variabel satt på containeren vinner over brukergrensesnittet og låser feltet (feltet viser et låsemerke som «Satt av LOGROTATE», eller «Satt av miljøet» for statistikken). Bruk brukergrensesnittet for alt som ikke er satt i containeren. Innstillinger merket «Omstart kreves» lagres med en gang, men leses når containeren starter. Seksjonen lister dem da under «Start containeren på nytt for å ta i bruk».

### Loggfiler

- **Skriv loggfiler**: skriver nginx feil-, stream- og tilgangsloggene til `/data/nginx/logs` og roterer dem daglig. Standard: av. Variabel: `LOGROTATE`. Tas i bruk etter nginx-omlastingen som lagringen kjører. Den blir på mens GoAccess kjører.
- **Antall loggrotasjoner som beholdes**: hvor mange roterte loggfiler som beholdes før den eldste slettes, 1 til 1000. Standard: 3. Variabel: `LOGROTATIONS`. Tas i bruk med en gang.

### GoAccess

- **GoAccess-rapport**: kjører GoAccess, en vevloggrapport for administratorer, under `/goaccess` i webgrensesnittet. Standard: av. Variabel: `GOA`. Tas i bruk etter en omstart av containeren. Den slår ikke på trafikkstatistikk.

Når rapporten er på, vises disse alternativene. Alle tas i bruk etter en omstart av containeren. Én variabel, `GOACLA`, erstatter alle med dine egne GoAccess-alternativer og låser dem.

- **Behold rapportdata**: 1 til 366 dager. Standard: 30.
- **Anonymiser besøkendes IP-er**: Av, Nivå 1 (standard), Nivå 2 (sterk) eller Nivå 3 (pedantisk). Nivå 1 skjuler den siste IPv4-byten (de siste 64 bitene av IPv6), nivå 2 to byte (80 bit), nivå 3 tre byte (96 bit).
- **Fjern spørrestrenger**: fjerner spørrestrenger fra URL-er i rapporten, så tokens i URL-er ikke lagres. Standard: på.
- **Fullstendige operativsystemversjoner**: viser hele versjonen, ikke bare familien. Standard: på.
- **Slå opp vertsnavn**: slår opp vertsnavn for besøkendes IP-er. Dette sender DNS-spørringer for dem. Standard: på.

### Overvåking

Disse styrer Trafikk-fanen på Overvåking-siden. Alle tas i bruk med en gang ved lagring. Variabler: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Trafikkstatistikk**: leser nginx-tilgangsloggen og teller forespørsler per vert, status, land og nettverk. Standard: av. Hvis du slår den av, stopper ny telling. Lagret statistikk blir stående til den er gammel nok, med mindre du krysser av for «Slett også den lagrede statistikken» i dialogen.
- **Behold statistikk i**: 7 til 365 dager. Standard: 30. Data per minutt beholdes i 24 timer, data per time like mange dager som dette.
- **Vis besøkendes IP-er**: lagrer besøkendes IP-er per time for å liste de mest aktive IP-ene. Standard: av, av hensyn til personvernet. Hvis du slår den av, slettes de lagrede IP-ene.
- **Tell unike besøkende**: lagrer en nøkkelbasert hash av hver besøkendes IP per vert og dag for å telle unike besøkende. Standard: av. Hvis du slår den av, slettes hashene.
- **Grense for besøkende per vert og dag**: 1000 til 1000000. Standard: 100000. En vert som når den, slutter å telle nye besøkende den dagen og viser et plusstegn.

Land og nettverk trenger GeoIP-databasene (Innstillinger, GeoIP).

Mer i wikien: Monitoring.
