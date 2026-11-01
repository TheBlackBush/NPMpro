## Authenticatie

Inloggen op de NPMpro-webinterface met een OIDC-provider (bijvoorbeeld Authentik, Keycloak of Google), naast of in plaats van wachtwoorden. Dit is geen forward-authenticatie: het beschermt uw proxy hosts niet. Zie daarvoor Instellingen, Forward-authenticatie.

Een variabele die op de container is gezet, gaat voor op de interface en vergrendelt het veld (het veld toont „Ingesteld door omgeving”). Als alle vier de verbindingsvariabelen zijn ingesteld, is OIDC actief zonder dat u het in de interface inschakelt. Gebruik de interface voor alles wat niet in de container is ingesteld. Alles hier geldt zodra u opslaat.

### Provider

- **Inloggen met OIDC inschakelen**: toont de inlogknop op de inlogpagina.
- **Issuer-URL**: het basisadres voor discovery van de provider, bijvoorbeeld `https://accounts.example.com`. Variabele: `OIDC_ISSUER_URL`.
- **Client-ID** en **Client secret**: van uw provider. Het secret wordt versleuteld opgeslagen en nooit meer getoond; laat het leeg om het te behouden. Als u de issuer-URL of het client-ID wijzigt, voer het secret opnieuw in. Variabelen: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Redirectdomein**: het domein waarmee men NPMpro opent, met de poort als die niet 443 is. Verplicht, omdat daaruit de callback-URL wordt opgebouwd. Variabele: `OIDC_REDIRECT_DOMAIN`.
- **Callback-URL**: alleen-lezen. Registreer haar als redirect-URI bij uw provider.
- **Scopes**: standaard `openid email profile`. Pas ze aan als uw provider er maar enkele toestaat, bijvoorbeeld `openid email`.
- **Verbinding testen**: controleert of NPMpro de issuer kan bereiken.

### Inlogknop

De knop op de inlogpagina: **Weergavenaam** (de tekst na „Inloggen met”), **Kleur** (een voorinstelling of uw eigen `#rrggbb`) en **Pictogram** (ingebouwd, geüpload als PNG, JPEG, WebP of SVG tot 256 KB, of gedownload van een URL). Er wordt een voorbeeld getoond.

### Inlogregels

- **Geverifieerd e-mailadres vereisen**: weigert gebruikers van wie de provider het e-mailadres niet heeft geverifieerd. Standaard: aan. Variabele: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Tweestapsverificatie na OIDC overslaan**: vertrouwt op de eigen multifactorcontrole van de provider. Standaard: uit. Variabele: `OIDC_SKIP_MFA`.
- **Inloggen met wachtwoord uitschakelen**: alleen OIDC kan inloggen. U kunt het alleen aanzetten vanuit een sessie die met OIDC is ingelogd. Variabele: `OIDC_DISABLE_PASSWORD`; om inloggen met wachtwoord te herstellen zet u haar op `false` en maakt u de container opnieuw aan.

### Nieuwe gebruikers

- **Gebruikers aanmaken bij hun eerste aanmelding** (standaard: uit): iemand zonder account krijgt er een met de onderstaande rechten.
- **Toegestane e-maildomeinen**: gescheiden door komma's; leeg staat elk domein toe. Bij een lege lijst en zonder vereist geverifieerd e-mailadres krijgt iedereen die uw provider accepteert een account.
- **Standaardrechten voor nieuwe gebruikers**: per sectie in te stellen. Nieuwe gebruikers zijn nooit beheerders.

Meer in de wiki: Authentication.
