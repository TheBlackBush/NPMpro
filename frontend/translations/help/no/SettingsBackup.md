## Sikkerhetskopiering og gjenoppretting

Lagre vertene, sertifikatene, brukerne og innstillingene dine i en `.npmpro`-fil, og gjenopprett den på denne eller en annen NPMpro-instans. Trafikkstatistikk og logger er aldri en del av en sikkerhetskopi.

### Opprett sikkerhetskopi

- **Hva som skal tas med**: deler som verter, tilgangslister, sertifikater, DNS-legitimasjon, brukere, innstillinger og egendefinerte filer. Alt er avkrysset til å begynne med.
- **Ta med hemmeligheter**: legger til private nøkler, passord, tofaktorhemmeligheter, verdiene til DNS-legitimasjon, OIDC-klienthemmeligheten og GeoIP-lisensnøkkelen. Filen krypteres med en **Passordfrase** på minst 12 tegn, som du skriver inn to ganger. NPMpro lagrer den ikke, så uten den kan ikke sikkerhetskopien gjenopprettes.
- Uten hemmeligheter er filen ikke kryptert og utelater hemmelighetene. Den inneholder fortsatt vertsnavn, brukere og innstillinger, så hold den privat.
- **Last ned** lagrer filen på datamaskinen din. **Behold på serveren** lagrer den i `/data/backups`.

### Planlagte sikkerhetskopier

Legg til planer som lager sikkerhetskopier av seg selv og lagrer dem på serveren.

- **Når**: hver N. time, daglig, ukentlig eller månedlig, i containerens tidssone.
- **Beskyttelse**: **Passordfrase** (gjenoppretter hvor som helst), **Instansnøkkel** (ingenting å huske, gjenoppretter bare på denne instansen) eller **Uten hemmeligheter**.
- **Behold**: hvor mange filer fra denne planen som beholdes. Eldre slettes etter hver vellykkede kjøring.
- En plan kan kjøres nå, settes på pause, redigeres eller slettes. En mislykket kjøring vises på planen og på dashbordet.

Planlagte sikkerhetskopier beskytter deg mot dårlige endringer, ikke mot at du mister disken. Kopier filene til en annen maskin for det.

### Lagrede sikkerhetskopier

Lister filene på serveren. Last ned, gjenopprett eller slett dem, eller **Last opp sikkerhetskopi**. NPMpro lager en **Automatisk** sikkerhetskopi før hver gjenoppretting, sammenslåing og databaseflytting. Den trenger ingen passordfrase og gjenopprettes bare på denne instansen.

### Gjenoppretting

- **Erstatt** bytter ut delene du velger på denne instansen med de i sikkerhetskopien. Din egen konto erstattes aldri.
- **Slå sammen** legger til elementene fra sikkerhetskopien og sletter ingenting. Den viser en forhåndsvisning og lar deg velge for hver konflikt: hopp over, bruk det eksisterende elementet, legg til som nytt, eller erstatt.

En gjenoppretting rulles tilbake hvis nginx avviser resultatet. En sikkerhetskopi fra en nyere NPMpro-versjon kan ikke gjenopprettes. Noen gjenopprettede innstillinger krever en omstart av containeren.

Denne seksjonen har ingen miljøvariabler.

Mer i wikien: Backup-and-restore.
