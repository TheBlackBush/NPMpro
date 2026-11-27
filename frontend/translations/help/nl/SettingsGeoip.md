## GeoIP

NPMpro downloadt zelf gratis GeoIP-databases (DB-IP Lite of MaxMind GeoLite2) en zoekt landen en netwerken op je server op, zodat IP's van bezoekers nergens heen worden gestuurd. U hebt geen aparte geoipupdate-container nodig. De databases voeden de kaart en lijsten in Monitoring, GoAccess en de nginx-landregels.

Een variabele die op de container is gezet, gaat voor op de interface en vergrendelt het veld (het veld toont „Ingesteld door omgeving”). Gebruik de interface voor alles wat niet in de container is ingesteld. Opslaan start de download op de achtergrond, en de status hieronder wordt bijgewerkt als hij klaar is.

### Provider

- **DB-IP Lite** is de standaard: gratis, geen account nodig, elke maand nieuwe bestanden (NPMpro controleert één keer per week). Variabele: `GEOIP_PROVIDER`.
- **MaxMind GeoLite2** blijft behouden: je hebt een gratis account en een licentiesleutel nodig, en het wordt twee keer per week bijgewerkt.

Er is steeds één provider actief en alleen de databases daarvan worden gebruikt. De bestanden van de andere provider blijven op schijf staan, dus terugschakelen vraagt geen nieuwe download. GoAccess neemt een wissel over bij de volgende start van de container. Variabele: `GEOIP_PROVIDER` (`dbip` of `maxmind`).

### DB-IP-databases

- **Country**: landen voor de kaart, de landenlijsten en de landregels van toegangslijsten.
- **ASN**: netwerken (AS-nummer en naam) voor de netwerklijsten.

Beide staan standaard aan. Variabele: `GEOIP_DBIP_EDITIONS`.

### MaxMind-account

U hebt een gratis MaxMind-account en een licentiesleutel nodig (in MaxMind: Account, Manage license keys). Op de pagina staat een link om u aan te melden.

- **Account-ID**: variabele `GEOIP_ACCOUNT_ID`.
- **Licentiesleutel**: versleuteld opgeslagen en nooit meer getoond. Als de opgeslagen sleutel niet kan worden ontsleuteld, voer hem opnieuw in. Variabele: `GEOIP_LICENSE_KEY`.

### Databases

- **GeoLite2 Country**: landen voor de kaart, de landlijsten en de nginx-landregels. Standaard aan.
- **GeoLite2 ASN**: netwerken (AS-nummer en naam) voor de netwerklijsten. Standaard aan.
- **GeoLite2 City**: optioneel, steden voor GoAccess. Een veel grotere download. Standaard uit.

Variabele: `GEOIP_EDITIONS`, gescheiden door spaties, bijvoorbeeld `GeoLite2-Country GeoLite2-ASN`. Als er geen database is gekozen, wordt niets gedownload of bijgewerkt, en blijven al gedownloade databases behouden.

### Status

Toont de laatste update en de laatste fout. NPMpro werkt de databases bij als u het account of de databases wijzigt, als u op **Nu bijwerken** klikt, en automatisch elke 3 dagen. Een mislukte automatische update wordt na 24 uur opnieuw geprobeerd. **Nu bijwerken** heeft een opgeslagen account-ID en licentiesleutel nodig.

Zonder databases zijn de kaart en de land- en netwerklijsten verborgen; de rest werkt.

Meer in de wiki: Monitoring.
