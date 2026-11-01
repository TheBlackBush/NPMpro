## Forward-authenticatie

Forward-authenticatie zet een login of botcontrole voor een proxy host. Bij elk verzoek vraagt nginx eerst aan een authenticatiedienst of de bezoeker erdoor mag. NPMpro heeft dit ingebouwd voor Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia en Authentik. De provider draait u in een eigen container.

Deze pagina stelt het standaardadres (upstream) van elke provider in. Een proxy host zet de controle aan met **Auth-verzoeken** onder Opties op zijn tabblad Details (of op een aangepaste locatie).

Een variabele die op de container is gezet, gaat voor op de interface en vergrendelt het veld (het veld toont een slotbadge zoals „Ingesteld door AUTH_REQUEST_AUTHELIA_UPSTREAM”). Gebruik de interface voor alles wat niet in de container is ingesteld. Elke instelling hier geldt na de nginx-herlaadactie die het opslaan uitvoert. Mislukt de nginx-test, dan wordt niets opgeslagen.

### Standaard-upstreams

- **Anubis-upstream**, **Tinyauth-upstream**, **OAuth2 Proxy-upstream**, **VoidAuth-upstream**, **Authelia-upstream**, **Authentik-upstream**: gebruikt door proxy hosts met die provider die geen eigen upstream hebben. De eigen waarde van een host gaat voor. Standaard: leeg (geen). Variabelen: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Indeling: `scheme://host:port`, bijvoorbeeld `http://127.0.0.1:9091`, of `scheme://cu_name` voor uw eigen nginx-upstreamblok waarvan de naam met `cu_` begint. Gebruik `http` of `https`; de poort is verplicht; een IPv6-adres staat tussen haakjes. Geen pad, geen spaties en geen van `; { } # " ' $ \`.

U kunt een standaard niet leegmaken zolang proxy hosts die provider zonder eigen upstream gebruiken. De melding noemt die hosts.

Een host die een provider gebruikt waarvoor nergens een upstream is ingesteld, krijgt een „Config error”.

### Anubis

- **Eigen Anubis-afbeeldingen**: toont uw eigen `happy.webp`, `reject.webp` en `pensive.webp` op de challengepagina's van Anubis. Standaard: aan als alle drie de bestanden bestaan en niet leeg zijn, anders uit. Variabele: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. De afbeeldingen horen in `public/anubis` in uw gegevensmap.

Meer in de wiki: Forward-Authentication.
