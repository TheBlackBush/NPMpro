## Landingspagina's

De pagina's die bezoekers zien in plaats van een site: wanneer voor een adres niets is ingesteld, een pagina niet wordt gevonden, de server achter een host niet antwoordt, een toegangslijst hen weigert, een host in onderhoud is, een certificaat ontbreekt, of CrowdSec hen blokkeert of controleert. Elke pagina verschijnt in de browsertaal van de bezoeker, in licht en donker.

### Standaardpagina

Wat een adres zonder host toont: **Felicitatiepagina**, **404-pagina**, **Geen respons (444)**, **Omleiden** (naar een adres dat u opgeeft) of **Aangepaste HTML** (uw eigen pagina).

### Globale pagina's

Voor elke pagina: haar NPMpro-pagina (bijvoorbeeld **404-foutpagina** of **Pagina ‘Toegang geweigerd’**) of een **Aangepaste pagina**. Een aangepaste pagina is één HTML-bestand (maximaal 1 MB, UTF-8) met de stijlen en afbeeldingen erin; plak het of gebruik **.html uploaden**. Ze kan het IP-adres van de bezoeker, de tijd, de statuscode en de hostnaam tonen met `<!--# echo var="remote_addr" -->`, `date_gmt`, `status` en `host`; andere server-side includes worden geweigerd.

Proxyhosts, 404-hosts en toegangslijsten gebruiken deze pagina's tenzij ze hun eigen kiezen (het tabblad **Pagina's** van een proxyhost, het veld **Pagina** van een 404-host, **Geweigerd** van een toegangslijst).

**Voorbeeld** opent de opgeslagen pagina in een nieuw tabblad met voorbeeldwaarden.

### CrowdSec

Instellingen, CrowdSec bepaalt of een blokkade een pagina toont, omleidt of alleen met een statuscode antwoordt; deze sectie bepaalt hoe de blokkade- en captcha-pagina's eruitzien.
