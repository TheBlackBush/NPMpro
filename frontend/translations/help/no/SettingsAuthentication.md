## Autentisering

Pålogging til NPMpro-grensesnittet med en OIDC-leverandør (for eksempel Authentik, Keycloak eller Google), ved siden av eller i stedet for passord. Dette er ikke videresendt autentisering: det beskytter ikke proxy-vertene dine. Se Innstillinger, Videresendt autentisering for det.

En variabel satt på containeren vinner over brukergrensesnittet og låser feltet (feltet viser «Satt av miljøet»). Hvis alle de fire tilkoblingsvariablene er satt, er OIDC aktivt uten at det er slått på i brukergrensesnittet. Bruk brukergrensesnittet for alt som ikke er satt i containeren. Alt her tas i bruk når du lagrer.

### Leverandør

- **Aktiver pålogging med OIDC**: viser påloggingsknappen på innloggingssiden.
- **Utsteder-URL**: leverandørens basisadresse for discovery, for eksempel `https://accounts.example.com`. Variabel: `OIDC_ISSUER_URL`.
- **Klient-ID** og **Klienthemmelighet**: fra leverandøren din. Hemmeligheten lagres kryptert og vises aldri igjen. La den stå tom for å beholde den. Hvis du endrer utsteder-URL eller klient-ID, må du skrive inn hemmeligheten på nytt. Variabler: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Omdirigeringsdomene**: domenet folk bruker for å åpne NPMpro, med porten hvis den ikke er 443. Påkrevd, fordi det brukes til å bygge callback-URL-en. Variabel: `OIDC_REDIRECT_DOMAIN`.
- **Callback-URL**: skrivebeskyttet. Registrer den som omdirigerings-URI hos leverandøren din.
- **Scopes**: standard er `openid email profile`. Endre den hvis leverandøren din bare tillater noen av dem, for eksempel `openid email`.
- **Test tilkobling**: kontrollerer at NPMpro kan nå utstederen.

### Påloggingsknapp

Knappen på påloggingssiden: **Visningsnavn** (teksten etter «Logg på med»), **Farge** (en forhåndsinnstilling eller din egen `#rrggbb`) og **Ikon** (innebygd, lastet opp som PNG, JPEG, WebP eller SVG på opptil 256 KB, eller lastet ned fra en URL). Det vises en forhåndsvisning.

### Påloggingsregler

- **Krev bekreftet e-post**: avviser brukere hvis leverandør ikke har bekreftet e-posten deres. Standard: på. Variabel: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Hopp over tofaktor etter OIDC**: stoler på leverandørens egen flerfaktorkontroll. Standard: av. Variabel: `OIDC_SKIP_MFA`.
- **Deaktiver pålogging med passord**: bare OIDC kan logge på. Du kan slå det på bare fra en økt som er logget på med OIDC. Variabel: `OIDC_DISABLE_PASSWORD`. For å gjenopprette pålogging med passord setter du den til `false` og oppretter containeren på nytt.

### Nye brukere

- **Opprett brukere ved første pålogging** (standard: av): en person uten konto får en med tillatelsene under.
- **Tillatte e-postdomener**: kommaseparert. Tomt tillater alle domener. Med en tom liste og uten krav om bekreftet e-post får alle som leverandøren din godtar en konto.
- **Standardtillatelser for nye brukere**: settes per seksjon. Nye brukere blir aldri administratorer.

Mer i wikien: Authentication.
