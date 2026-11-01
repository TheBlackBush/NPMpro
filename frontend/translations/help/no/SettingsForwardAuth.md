## Videresendt autentisering

Videresendt autentisering setter en innlogging eller botkontroll foran en proxy-vert. For hver forespørsel spør nginx først en autentiseringstjeneste om den besøkende får slippe gjennom. NPMpro har dette innebygd for Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia og Authentik. Du kjører leverandøren i sin egen container.

Denne siden setter standardadressen (upstream) for hver leverandør. En proxy-vert slår på kontrollen med **Auth Request** under Alternativer i fanen Detaljer (eller på en egendefinert lokasjon).

En variabel satt på containeren vinner over brukergrensesnittet og låser feltet (feltet viser et låsemerke som «Satt av AUTH_REQUEST_AUTHELIA_UPSTREAM»). Bruk brukergrensesnittet for alt som ikke er satt i containeren. Alle innstillinger her tas i bruk etter nginx-omlastingen som lagringen kjører. Hvis nginx-testen feiler, lagres ingenting.

### Standard-upstreams

- **Anubis-upstream**, **Tinyauth-upstream**, **OAuth2 Proxy-upstream**, **VoidAuth-upstream**, **Authelia-upstream**, **Authentik-upstream**: brukes av proxy-verter med den leverandøren som ikke har noen egen upstream. Vertens egen verdi vinner. Standard: tom (ingen). Variabler: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Format: `scheme://host:port`, for eksempel `http://127.0.0.1:9091`, eller `scheme://cu_name` for din egen nginx-upstream-blokk der navnet starter med `cu_`. Bruk `http` eller `https`. Porten er påkrevd, og en IPv6-adresse settes i hakeparenteser. Ingen sti, ingen mellomrom og ingen av `; { } # " ' $ \`.

Du kan ikke tømme en standard så lenge proxy-verter bruker den leverandøren uten egen upstream. Meldingen lister disse vertene.

En vert som bruker en leverandør uten upstream noe sted, får en «Konfigurasjonsfeil».

### Anubis

- **Egne Anubis-bilder**: viser dine egne `happy.webp`, `reject.webp` og `pensive.webp` på Anubis-utfordringssidene. Standard: på når alle tre filene finnes og ikke er tomme, ellers av. Variabel: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. Bildene legges i `public/anubis` i datamappen din.

Mer i wikien: Forward-Authentication.
