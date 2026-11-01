## Wat is een Proxy Host?

Een Proxy Host is de voordeur van een webdienst. Bezoekers openen uw domein in NPMpro, en NPMpro stuurt het verzoek door naar de dienst erachter. Hij kan ook TLS (HTTPS) toevoegen voor diensten die zelf geen TLS hebben. Proxy Hosts zijn de meest voorkomende toepassing van NPMpro.

Gebruik **Dupliceren** in het menu van de host om een host naar een nieuw venster Toevoegen te kopiëren. De kopie begint zonder de domeinnamen, omdat een domein maar bij één ingeschakelde host kan horen.

### Details

- **Domeinnamen**: de namen die bezoekers gebruiken. Verplicht. Voor een nieuw certificaat hebben wildcards (`*.example.com`) de DNS-challenge nodig.
- **Schema**: hoe NPMpro met de dienst praat: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (bestanden of PHP uit een map aanbieden) of `empty` (geen upstream). Standaard `http://`. Een wijziging van het schema schakelt opties uit die er niet bij passen.
- **Hostname / IP / Path Doorsturen**: het adres van de dienst. U kunt een subpad toevoegen, bijvoorbeeld `127.0.0.1/path`. Bij `path` voert u in plaats daarvan een map in. Koppel uw bestanden onder `/var/www`; alleen beheerders kunnen een map daarbuiten gebruiken. Een naam die met `cu_` begint, verwijst naar uw eigen nginx-upstreamblok (zie Load balancing in de wiki).
- **Poort doorsturen**: optioneel. Bij `path` is het de PHP-versie.
- **Groep**: een vrij label dat lange lijsten overzichtelijk houdt.
- **Opties** (allemaal standaard uit):
  - **Noindex-header versturen en sommige bot user agents blokkeren**: vraagt zoekmachines de site niet te indexeren en blokkeert enkele crawlers.
  - **Crowdsec Appsec uitschakelen**: schakelt CrowdSec AppSec alleen voor deze host uit. Werkt alleen als AppSec is ingesteld.
  - **Request Buffering uitschakelen** en **Response Buffering uitschakelen**: voor http- en https-upstreams. Laat buffering aan, tenzij u streamt of grote bestanden uploadt over een snelle, stabiele verbinding. Als u request buffering uitschakelt, gaat ook AppSec uit.
  - **Upstream-compressie inschakelen**: laat de dienst zijn eigen antwoorden comprimeren. Laat het uit tenzij de dienst het nodig heeft. Niet voor `path` en `empty`.
  - **Fancyindex inschakelen**: toont een bestandslijst als een map geen indexbestand heeft. Alleen voor `path`.
- **X-Frame-Options**: `SAMEORIGIN` (standaard), `DENY`, `none` (verwijdert de header) of `upstream` (behoudt wat de dienst stuurt).
- **Auth-verzoeken**: zet een login of botcontrole voor de host (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Standaard `none`. **Upstream Auth-verzoeken** is optioneel; leeg gebruikt de standaard uit Instellingen, Forward-authenticatie.
- **Globale toegangslijst**: **Publiekelijk toegankelijk** (standaard, geen login) of **Aangepast**, een of meer toegangslijsten.

Websockets staan altijd aan.

### Aangepaste locaties

Een locatie stuurt één pad van de host (bijvoorbeeld `/api/`) naar een andere dienst. Elke heeft **Ingeschakeld**, een pad met een optioneel overeenkomsttype (`=`, `~`, `~*`, `^~` of `@`), een eigen schema, host, poort, opties, Auth-verzoek en toegangslijsten. De toegangslijst kan **Globaal** zijn, dan gelden de lijsten van de host. Een locatie erft het Auth-verzoek van de host niet. Voeg een slash aan een pad toe, tenzij u prefix-overeenkomst wilt. Beheerders kunnen met de tandwielknop per locatie eigen nginx-configuratie toevoegen.

### TLS

- **TLS-certificaat**: Geen, Een nieuw certificaat aanvragen, of een bestaand. De opties hieronder hebben een certificaat nodig.
- **mTLS-certificaat**: een certificeringsinstantie voor clientcertificaten. **mTLS optioneel maken** laat bezoekers zonder certificaat binnen. **mTLS omzeilt Auth-verzoek** laat bezoekers met een geldig certificaat het Auth-verzoek overslaan.
- **HTTPS forceren** leidt HTTP om naar HTTPS. **HTTP/3-ondersteuning** staat HTTP/3 (QUIC) toe.
- **HSTS ingeschakeld (2 jaar)**: heeft HTTPS forceren nodig. **HSTS Subdomeinen+Preload** heeft HSTS nodig.
- Voor een nieuw certificaat: **Sleutel hergebruiken (niet aanbevolen)** en **DNS-challenge gebruiken**, met provider, inloggegevens en propagatietijd in seconden.

### Geavanceerd

Eigen nginx-configuratie voor de hele host (serverblok) en voor de hoofdlocatie `location /`. Alleen beheerders kunnen die wijzigen.

Meer in de wiki: Host options.
