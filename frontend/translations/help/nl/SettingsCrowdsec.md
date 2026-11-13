## CrowdSec

Verbindt de in NPMpro ingebouwde CrowdSec-bouncer met uw CrowdSec-container. Elk verzoek aan uw hosts wordt gecontroleerd aan de hand van de besluiten van de CrowdSec Local API (LAPI) en, met een AppSec-URL, aan de hand van de AppSec-regels. Opslaan past de instellingen direct toe met een nginx-reload; de container wordt niet herstart.

NPMpro schrijft `/data/crowdsec/crowdsec.conf` op basis van deze instellingen. Handmatige wijzigingen in dat bestand worden overschreven. `ban.html` en `captcha.html` in dezelfde map kunt u zelf bewerken.

Een variabele die op de container is ingesteld, wint van de interface en vergrendelt het veld: `CROWDSEC_ENABLED`, `CROWDSEC_LAPI_URL`, `CROWDSEC_API_KEY`, `CROWDSEC_APPSEC_URL`.

### Status en Verbinding testen

Toont of nginx de bouncer laadt en wanneer NPMpro de LAPI voor het laatst heeft bereikt. **Verbinding testen** controleert de waarden in het formulier: één besluitenverzoek aan de LAPI met de sleutel (of het TLS-clientcertificaat) en, met een AppSec-URL, één verzoek aan AppSec. Een leeg gelaten sleutelveld gebruikt de opgeslagen sleutel.

Opslaan terwijl de bouncer aan staat voert eerst dezelfde test uit. Als die mislukt, worden de redenen getoond en slaat **Toch opslaan** toch op, bijvoorbeeld als CrowdSec nog niet draait.

**Toch opslaan** wordt niet aangeboden als AppSec faalt, **Wanneer AppSec niet bereikbaar is** op **Het verzoek weigeren** staat en de beheerinterface wordt gecontroleerd, omdat u zich met die opslag uit de beheerinterface zou buitensluiten: corrigeer de **API-sleutel** of de **AppSec-URL**, zet de actie bij uitval op **Het verzoek doorlaten**, of zet **De beheerinterface uitsluiten van CrowdSec** aan.

### Verbinding

- **De bouncer inschakelen**: controleert elk verzoek.
- **LAPI-URL**: bijvoorbeeld `http://127.0.0.1:8080`.
- **API-sleutel**: uit `docker exec crowdsec cscli bouncers add npmpro`. Versleuteld opgeslagen, nooit meer getoond. **Opgeslagen sleutel verwijderen** wist hem.
- **TLS-clientcertificaat**: in plaats van de sleutel een certificaat- en een sleutelbestand onder `/data/crowdsec/`; vereist een LAPI-URL met `https://`. Zodra een AppSec-URL is ingesteld, wordt het veld **API-sleutel** ook met een TLS-clientcertificaat getoond en is het verplicht, omdat AppSec met de API-sleutel authenticeert; zonder sleutel weigert AppSec elk verzoek.
- **TLS-certificaten verifiëren**: controleert het certificaat van een https-LAPI- of AppSec-URL.

### Blokkering

- **Modus**: live vraagt de LAPI om elk client-IP en cachet het antwoord voor het opgegeven aantal seconden; stream downloadt alle besluiten met het opgegeven interval.
- **Antwoord op een ban**: de banpagina (met een optionele statuscode, standaard 403), een omleiding, of een statuscode zonder pagina.
- **Terugvalmaatregel** en **Besluittypen**: hoe besluiten worden behandeld die de bouncer niet kan toepassen, en welke typen worden afgedwongen.
- **De beheerinterface uitsluiten van CrowdSec**: verzoeken aan de beheerinterface slaan de bouncer en AppSec over. Zet dit aan voordat u AppSec met weigeren gebruikt, zodat een CrowdSec-storing u niet kan buitensluiten.

### Captcha

De aanbieder (reCAPTCHA, hCaptcha, Cloudflare Turnstile), de sitesleutel en geheime sleutel ervan, en hoe lang een opgeloste captcha geldig blijft. Gebruikt voor besluiten van het type captcha.

### AppSec

- **AppSec-URL**: bijvoorbeeld `http://127.0.0.1:7422`; leeg schakelt AppSec uit.
- **Wanneer AppSec niet bereikbaar is**: weigeren blokkeert elk gecontroleerd verzoek zolang AppSec onbereikbaar is; doorlaten laat ze ongecontroleerd door.

### Geavanceerd

De LAPI-verzoektimeout, scenariofilters, uitgesloten paden, interne verzoeken, de AppSec-timeouts en -opties, en de bestanden van de ban- en captchapagina's met een **Voorbeeld**.

### Buitengesloten?

Start CrowdSec opnieuw, of stel `CROWDSEC_ENABLED=false` in op de container en maak hem opnieuw aan; corrigeer daarna de instellingen hier.

Meer in de wiki: CrowdSec.
