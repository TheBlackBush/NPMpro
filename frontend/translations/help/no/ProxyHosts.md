## Hva er en proxy-vert?

En proxy-vert er inngangsdøren til en webtjeneste. Besøkende åpner domenet ditt i NPMpro, og NPMpro sender forespørselen videre til tjenesten bak. Den kan også legge til TLS (HTTPS) for tjenester som ikke har det selv. Proxy-verter er den vanligste bruken av NPMpro.

Bruk **Klon** i vertens meny for å kopiere en vert til et nytt Legg til-vindu. Kopien starter uten domenenavnene, fordi et domene bare kan tilhøre én aktivert vert.

### Detaljer

- **Domener**: navnene de besøkende bruker. Påkrevd. For et nytt sertifikat krever jokertegn (`*.example.com`) DNS-utfordringen.
- **Skjema**: hvordan NPMpro snakker med tjenesten: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (server filer eller PHP fra en mappe) eller `empty` (ingen upstream). Standard er `http://`. Hvis du bytter skjema, slås alternativer som ikke passer av.
- **Videresend til vertsnavn / IP / sti**: adressen til tjenesten. Du kan legge til en understi, for eksempel `127.0.0.1/path`. Med `path` skriver du inn en mappe i stedet. Monter filene dine under `/var/www`. Bare administratorer kan bruke en mappe utenfor den. Et navn som starter med `cu_` peker til din egen nginx-upstream-blokk (se Load balancing i wikien).
- **Viderekoble Port**: valgfri. Med `path` er det PHP-versjonen.
- **Gruppe**: en fri etikett som holder lange lister ryddige.
- **Alternativer** (alle av som standard):
  - **Send noindex-header og blokker enkelte bot-brukeragenter**: ber søkemotorer om ikke å indeksere nettstedet og blokkerer noen crawlere.
  - **Deaktiver CrowdSec AppSec**: slår CrowdSec AppSec av bare for denne verten. Det har bare effekt hvis AppSec er satt opp.
  - **Deaktiver bufring av forespørsler** og **Deaktiver bufring av svar**: for http- og https-upstreams. La bufring være på med mindre du strømmer eller laster opp store filer over en rask, stabil forbindelse. Hvis du slår av bufring av forespørsler, slås også AppSec av.
  - **Aktiver komprimering fra upstream**: lar tjenesten komprimere sine egne svar. La den være av med mindre tjenesten trenger det. Ikke for `path` og `empty`.
  - **Aktiver fancyindex**: viser en filliste når en mappe ikke har noen indeksfil. Bare for `path`.
- **X-Frame-Options**: `SAMEORIGIN` (standard), `DENY`, `none` (fjerner headeren) eller `upstream` (beholder det tjenesten sender).
- **Auth Request**: setter en innlogging eller botkontroll foran verten (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Standard er `none`. **Auth Request-upstream** er valgfri. Tom bruker standarden fra Innstillinger, Videresendt autentisering.
- **Globale tilgangslister**: **Offentlig tilgjengelig** (standard, ingen innlogging) eller **Egendefinert**, én eller flere tilgangslister.

WebSockets er alltid på.

### Egendefinerte lokasjoner

En lokasjon sender én sti på verten (for eksempel `/api/`) til en annen tjeneste. Hver har **Aktivert**, en sti med valgfri treffetype (`=`, `~`, `~*`, `^~` eller `@`), eget skjema, vert, port, alternativer, Auth Request og tilgangslister. Tilgangslisten kan være **Global**, som bruker vertens lister. Den arver ikke vertens Auth Request. Legg til en avsluttende skråstrek på en sti, med mindre du vil ha prefikstreff. Administratorer kan legge til egendefinert nginx-konfigurasjon per lokasjon med tannhjulknappen.

### TLS

- **TLS-sertifikat**: Ingen, be om et nytt sertifikat, eller et eksisterende. Alternativene under krever et sertifikat.
- **mTLS-sertifikat**: en sertifiseringsinstans for klientsertifikater. **Gjør mTLS valgfritt** slipper inn besøkende uten sertifikat. **mTLS hopper over Auth Request** lar besøkende med et gyldig sertifikat hoppe over Auth Request.
- **Tving HTTPS** omdirigerer HTTP til HTTPS. **HTTP/3-støtte** tillater HTTP/3 (QUIC).
- **HSTS aktivert (2 år)**: krever Tving HTTPS. **HSTS for underdomener + preload** krever HSTS.
- For et nytt sertifikat: **Gjenbruk nøkkel (anbefales ikke)** og **Bruk DNS Utfordring**, med leverandør, legitimasjon og sekunder for propagering.

### Avansert

Egendefinert nginx-konfigurasjon for hele verten (server-blokken) og for hovedlokasjonen `location /`. Bare administratorer kan endre den.

Mer i wikien: Host options.
