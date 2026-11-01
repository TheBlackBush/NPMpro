## Logs en monitoring

Logbestanden, het GoAccess-lograpport en de verkeersstatistieken achter de pagina Monitoring.

Een variabele die op de container is gezet, gaat voor op de interface en vergrendelt het veld (het veld toont een slotbadge zoals „Ingesteld door LOGROTATE”, of „Ingesteld door omgeving” bij de statistieken). Gebruik de interface voor alles wat niet in de container is ingesteld. Instellingen met „Herstart vereist” worden direct opgeslagen maar pas gelezen als de container start; de sectie noemt ze dan onder „Herstart de container om toe te passen”.

### Logbestanden

- **Logbestanden schrijven**: schrijft de nginx-fout-, stream- en toegangslogs naar `/data/nginx/logs` en roteert ze dagelijks. Standaard: uit. Variabele: `LOGROTATE`. Geldt na de nginx-herlaadactie die het opslaan uitvoert. Blijft aan zolang GoAccess draait.
- **Bewaarde logrotaties**: hoeveel geroteerde logbestanden worden bewaard voordat het oudste wordt verwijderd, 1 tot 1000. Standaard: 3. Variabele: `LOGROTATIONS`. Geldt direct.

### GoAccess

- **GoAccess-rapport**: draait GoAccess, een weblograpport voor beheerders, onder `/goaccess` van de webinterface. Standaard: uit. Variabele: `GOA`. Geldt na een herstart van de container. Het zet verkeersstatistieken niet aan.

Bij een ingeschakeld rapport verschijnen deze opties. Alle gelden na een herstart van de container. Eén variabele, `GOACLA`, vervangt ze allemaal door uw eigen GoAccess-opties en vergrendelt ze.

- **Rapportgegevens bewaren**: 1 tot 366 dagen. Standaard: 30.
- **IP's van bezoekers anonimiseren**: Uit, Niveau 1 (standaard), Niveau 2 (sterk) of Niveau 3 (zeer streng). Niveau 1 verbergt de laatste IPv4-byte (de laatste 64 bits van IPv6), niveau 2 twee bytes (80 bits), niveau 3 drie bytes (96 bits).
- **Querystrings weglaten**: verwijdert querystrings uit URL's in het rapport, zodat tokens in URL's niet worden opgeslagen. Standaard: aan.
- **Volledige besturingssysteemversies**: toont de volledige versie, niet alleen de familie. Standaard: aan.
- **Hostnamen opzoeken**: zoekt hostnamen van IP's van bezoekers op. Hierbij worden DNS-query's verstuurd. Standaard: aan.

### Monitoring

Deze sturen het tabblad Verkeer van de pagina Monitoring aan. Alle gelden direct bij het opslaan. Variabelen: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Verkeersstatistieken**: leest het nginx-toegangslog en telt verzoeken per host, status, land en netwerk. Standaard: uit. Uitzetten stopt het nieuwe tellen; opgeslagen statistieken blijven staan tot ze verouderen, tenzij u in het dialoogvenster „Ook de opgeslagen statistieken verwijderen” aanvinkt.
- **Statistieken bewaren gedurende**: 7 tot 365 dagen. Standaard: 30. Gegevens per minuut worden 24 uur bewaard, gegevens per uur zoveel dagen.
- **IP's van bezoekers tonen**: slaat IP's van bezoekers per uur op om de meest voorkomende IP's te tonen. Standaard: uit, voor de privacy. Uitzetten verwijdert de opgeslagen IP's.
- **Unieke bezoekers tellen**: slaat per host en dag een hash met sleutel van elk bezoekers-IP op om unieke bezoekers te tellen. Standaard: uit. Uitzetten verwijdert de hashes.
- **Bezoekerslimiet per host per dag**: 1000 tot 1000000. Standaard: 100000. Een host die dit bereikt, telt die dag geen nieuwe bezoekers meer en toont een plusteken.

Landen en netwerken hebben de GeoIP-databases nodig (Instellingen, GeoIP).

Meer in de wiki: Monitoring.
