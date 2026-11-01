## Database

De database waarin NPMpro zijn hosts, certificaten, gebruikers, logs en statistieken bewaart. Standaard is dat SQLite, één bestand, en dat is de aanbevolen keuze. Van hieruit kunt u alles verplaatsen naar MySQL, MariaDB, PostgreSQL of een nieuw SQLite-bestand. De database die in gebruik is, wordt door een verplaatsing niet gewijzigd.

### Database in gebruik

Toont het databasesysteem en de versie, waar het staat, de grootte en de **Bron** van de verbinding: **Standaard** (het SQLite-bestand `/data/npmpro/database.sqlite`), **Bestand met database-instellingen** (`/data/npmpro/database.json`, geschreven door een verplaatsing) of **Omgeving** (`DB_MYSQL_*`- of `DB_POSTGRES_*`-variabelen). Na een verplaatsing staat er wanneer en vanuit welk systeem u bent verhuisd.

### Tabellen

Elke tabel met zijn rijen en grootte. De kaart kan worden ingeklapt.

### Naar een andere database verplaatsen

Maak eerst op uw server een lege database en een gebruiker die tabellen mag aanmaken; NPMpro maakt de database niet aan. Vereisten: MySQL 8.0, MariaDB 10.6 of PostgreSQL 13 of nieuwer.

1. Kies het **Databasesysteem** en voer **Host**, **Poort**, **Databasenaam**, **Gebruiker** en **Wachtwoord** in. Zet **TLS gebruiken** aan als de server het nodig heeft (bij MySQL en MariaDB kunt u ook **Servercertificaat controleren** en **Servernaam controleren**). Een verplaatsing naar SQLite heeft niets nodig: ze maakt een nieuw bestand in `/data/npmpro`.
2. **Verbinding testen**. Dit controleert de versie, of de database leeg is en of de gebruiker tabellen kan aanmaken. Het verandert niets.
3. **Verplaatsen**, typ dan het gevraagde woord en klik op **Nu verplaatsen**.

NPMpro pauzeert wijzigingen, maakt een veiligheidsback-up, maakt de tabellen aan, kopieert en controleert elke rij en herstart dan op de nieuwe database. Uw sites blijven bediend worden. De pagina laadt opnieuw zodra NPMpro weer antwoordt, en mogelijk moet u opnieuw inloggen.

Als een stap mislukt, blijft NPMpro op de database die het gebruikte, en het venster noemt de stap die is gestopt. De oude database wordt nooit verwijderd, dus u kunt terug: verwijder `/data/npmpro/database.json` en herstart de container.

Als de verbinding uit `DB_MYSQL_*`- of `DB_POSTGRES_*`-variabelen komt, is de sectie alleen-lezen. Om te verplaatsen maakt u een back-up, wijst u de variabelen naar de nieuwe database, herstart u en herstelt u de back-up.

Meer in de wiki: Database.
