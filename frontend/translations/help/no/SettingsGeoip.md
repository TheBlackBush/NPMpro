## GeoIP

NPMpro laster selv ned de gratis MaxMind GeoLite2-databasene og slår opp land og nettverk på serveren din, så besøkendes IP-er sendes aldri noe sted. Du trenger ingen egen geoipupdate-container. Databasene mater kartet og listene i Overvåking, GoAccess og nginx-landsregler.

En variabel satt på containeren vinner over brukergrensesnittet og låser feltet (feltet viser «Satt av miljøet»). Bruk brukergrensesnittet for alt som ikke er satt i containeren. Lagring starter nedlastingen i bakgrunnen, og statusen under oppdateres når den er ferdig.

### MaxMind-konto

Du trenger en gratis MaxMind-konto og en lisensnøkkel (i MaxMind: Account, Manage license keys). Det finnes en lenke for registrering på siden.

- **Konto-ID**: variabel `GEOIP_ACCOUNT_ID`.
- **Lisensnøkkel**: lagres kryptert og vises aldri igjen. Hvis den lagrede nøkkelen ikke kan dekrypteres, skriver du den inn på nytt. Variabel: `GEOIP_LICENSE_KEY`.

### Databaser

- **GeoLite2 Country**: land for kartet, landslistene og nginx-landsregler. På som standard.
- **GeoLite2 ASN**: nettverk (AS-nummer og navn) for nettverkslistene. På som standard.
- **GeoLite2 City**: valgfri, byer for GoAccess. En mye større nedlasting. Av som standard.

Variabel: `GEOIP_EDITIONS`, adskilt med mellomrom, for eksempel `GeoLite2-Country GeoLite2-ASN`. Hvis ingen database er valgt, lastes ingenting ned eller oppdateres, og databaser som allerede er lastet ned, beholdes.

### Status

Viser siste oppdatering og siste feil. NPMpro oppdaterer databasene når du endrer kontoen eller databasene, når du klikker **Oppdater nå**, og automatisk hver 3. dag. En mislykket automatisk oppdatering prøves igjen etter 24 timer. **Oppdater nå** krever en lagret konto-ID og lisensnøkkel.

Uten databaser skjules kartet og land- og nettverkslistene. Resten fungerer.

Mer i wikien: Monitoring.
