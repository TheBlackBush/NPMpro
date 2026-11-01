## Database

Databasen NPMpro lagrer vertene, sertifikatene, brukerne, loggene og statistikken sin i. Som standard er dette SQLite, én enkelt fil, og det er det anbefalte valget. Herfra kan du flytte alt til MySQL, MariaDB, PostgreSQL eller en ny SQLite-fil. Databasen som er i bruk, endres ikke av en flytting.

### Database i bruk

Viser databasesystemet og versjonen, hvor den er, størrelsen og **Kilde** til tilkoblingen: **Standard** (SQLite-filen `/data/npmpro/database.sqlite`), **Fil med databaseinnstillinger** (`/data/npmpro/database.json`, skrevet av en flytting) eller **Miljø** (variablene `DB_MYSQL_*` eller `DB_POSTGRES_*`). Etter en flytting står det når og fra hvilket databasesystem du flyttet.

### Tabeller

Hver tabell med antall rader og størrelse. Kortet kan lukkes.

### Flytt til en annen database

Opprett først en tom database og en bruker som kan opprette tabeller på serveren din. NPMpro oppretter ikke databasen. Krav: MySQL 8.0, MariaDB 10.6 eller PostgreSQL 13 eller nyere.

1. Velg **Databasesystem** og skriv inn **Vert**, **Port**, **Databasenavn**, **Bruker** og **Passord**. Slå på **Bruk TLS** hvis serveren krever det (for MySQL og MariaDB kan du også **Kontroller serversertifikatet** og **Kontroller servernavnet**). En flytting til SQLite trenger ingenting: den oppretter en ny fil i `/data/npmpro`.
2. **Test tilkobling**. Den kontrollerer versjonen, at databasen er tom og at brukeren kan opprette tabeller. Den endrer ingenting.
3. **Flytt**, skriv deretter inn ordet den ber om og klikk **Flytt nå**.

NPMpro setter endringer på pause, lager en sikkerhetskopi for sikkerhets skyld, oppretter tabellene, kopierer og kontrollerer hver rad, og starter deretter på nytt på den nye databasen. Nettstedene dine blir fortsatt servert. Siden lastes på nytt når NPMpro svarer igjen, og du må kanskje logge på på nytt.

Hvis et trinn feiler, blir NPMpro værende på databasen den brukte, og vinduet navngir trinnet som stoppet. Den gamle databasen slettes aldri, så du kan gå tilbake: fjern `/data/npmpro/database.json` og start containeren på nytt.

Hvis tilkoblingen kommer fra variablene `DB_MYSQL_*` eller `DB_POSTGRES_*`, er seksjonen skrivebeskyttet. For å flytte lager du en sikkerhetskopi, peker variablene mot den nye databasen, starter på nytt og gjenoppretter sikkerhetskopien.

Mer i wikien: Database.
