## Hjelp om sertifikater

### HTTP‑sertifikat

Et HTTP‑validert sertifikat betyr at Certbot‑serverne vil forsøke å nå
domenene dine over HTTP (ikke HTTPS!) og hvis det lykkes, vil de utstede sertifikatet.

For denne metoden må du ha en `Proxy‑host` opprettet for domenet/domenene dine som
er tilgjengelig over HTTP og peker til denne Nginx‑installasjonen. Etter at et sertifikat
er utstedt, kan du endre `Proxy‑host` til også å bruke dette sertifikatet for HTTPS‑tilkoblinger.
Proxy‑hosten må imidlertid fortsatt være konfigurert for HTTP‑tilgang for at sertifikatet skal kunne fornyes.

Denne prosessen _støtter ikke_ wildcard‑domener.

### DNS‑sertifikat

Et DNS‑validert sertifikat krever at du bruker en DNS‑leverandør‑plugin. Denne leverandøren
vil opprette midlertidige DNS‑poster på domenet ditt, og Certbot vil deretter spørre
disse postene for å bekrefte at du eier domenet. Hvis valideringen lykkes, utstedes sertifikatet.

Du trenger ikke å ha en `Proxy‑host` opprettet før du ber om denne typen sertifikat. Du trenger heller
ikke at `Proxy‑host` er konfigurert for HTTP‑tilgang.

Denne prosessen _støtter_ wildcard‑domener.

#### Lagret DNS-påloggingsinformasjon

Legitimasjonen for DNS‑leverandøren din lagres separat fra sertifikatet, i fanen
_DNS-påloggingsinformasjon_ på siden Sertifikater. Et sertifikat velger deretter bare én av de
lagrede legitimasjonene, slik at flere sertifikater kan dele dem.

Hemmeligheter lagres kryptert og vises aldri igjen. Når du redigerer en legitimasjon, lar du
en hemmelighet stå tom for å beholde den lagrede verdien. Nøkkelen som brukes til krypteringen, er filen
`/data/npmpro/dns-credentials.key`. Ta sikkerhetskopi av den sammen med databasen, ellers
kan ikke den lagrede legitimasjonen leses etter en gjenoppretting.

Leverandører uten skjema bruker INI‑tekstboksen, der du limer inn innholdet i
legitimasjonsfilen for den leverandøren.

### Egendefinert sertifikat

Bruk dette alternativet for å laste opp ditt eget TLS‑sertifikat, levert av din
egen sertifikatmyndighet (CA).
