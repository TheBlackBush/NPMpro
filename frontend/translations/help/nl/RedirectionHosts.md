## Wat is een Redirection Host?

Een Redirection Host stuurt bezoekers van het ene domein naar een ander adres. Gebruik hem als een site van domein verandert en oude links moeten blijven werken, of om `www` naar de hoofdnaam te sturen.

Gebruik **Dupliceren** in het menu van de host om een host naar een nieuw venster Toevoegen te kopiëren. De kopie begint zonder de domeinnamen, omdat een domein maar bij één ingeschakelde host kan horen.

### Details

- **Domeinnamen**: de namen die worden omgeleid. Verplicht. Wildcards zijn voor een nieuw certificaat alleen toegestaan met de DNS-challenge.
- **Schema**: het schema van het doel. „behouden (zelfde als het verzoek)” is de standaard en behoudt `http` of `https` van het bezoek. Of kies `http` of `https`.
- **Doorgestuurd Domein**: het domein waarheen bezoekers worden gestuurd, bijvoorbeeld `example.com`. Verplicht.
- **HTTP-code**: de antwoordcode. Standaard 301 Moved permanently. Andere keuzes: 302 Moved temporarily, 303 See other, 307 Temporary redirect en 308 Permanent redirect. Gebruik 301 of 308 als de verhuizing definitief is; browsers en zoekmachines onthouden ze.
- **Groep**: een vrij label dat lange lijsten overzichtelijk houdt. Kies een bestaande of typ een nieuwe naam.
- **Pad behouden** (standaard uit): voegt het oorspronkelijke pad en de query toe aan het doel. Dan gaat `old.example/a?b=1` naar `new.example/a?b=1`. Zonder komt elke bezoeker aan het begin van het doel terecht.

### TLS

- **TLS-certificaat**: Geen, Een nieuw certificaat aanvragen, of een bestaand. De opties hieronder hebben een certificaat nodig.
- **mTLS-certificaat**: een certificeringsinstantie voor clientcertificaten. **mTLS optioneel maken** laat bezoekers zonder clientcertificaat binnen.
- **HTTPS forceren**: leidt HTTP eerst om naar HTTPS.
- **HTTP/3-ondersteuning**: staat HTTP/3 (QUIC) toe.
- **HSTS ingeschakeld (2 jaar)**: heeft HTTPS forceren nodig. **HSTS Subdomeinen+Preload** heeft HSTS nodig.
- Voor een nieuw certificaat: **Sleutel hergebruiken (niet aanbevolen)** en **DNS-challenge gebruiken**, met provider, inloggegevens en propagatietijd in seconden.

Alle TLS-opties staan standaard uit.

### Geavanceerd

Eigen nginx-configuratie die in het serverblok van de host wordt toegevoegd. Alleen beheerders kunnen die wijzigen; andere gebruikers zien haar alleen-lezen.

Meer in de wiki: Host options.
