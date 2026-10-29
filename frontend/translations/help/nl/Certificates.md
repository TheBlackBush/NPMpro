## Certificaten - Hulp

### HTTP-certificaat

Een HTTP-gevalideerd certificaat betekent dat Certbot-servers zullen proberen uw domeinen te bereiken via HTTP (niet HTTPS!) en als dit lukt, geven ze uw certificaat af.

Voor deze methode moet u een _Proxy Host_ laten maken voor uw domein(en) die toegankelijk is met HTTP en die naar deze Nginx-installatie verwijst. Nadat een certificaat is gegeven, kunt u de _Proxy Host_ wijzigen om dit certificaat ook voor HTTPS-verbindingen te gebruiken. De _Proxy Host_ moet echter nog steeds worden geconfigureerd voor HTTP-toegang voordat het certificaat kan worden verlengd.

Dit proces ondersteunt _niet_ jokertekendomeinen.

### DNS-certificaat

Een DNS gevalideerd certificaat vereist dat u een DNS-provider plugin gebruikt. Deze DNS-provider wordt gebruikt om tijdelijke records op uw domein aan te maken en vervolgens zal Certbot die records opvragen om er zeker van te zijn dat u de eigenaar bent en als dit lukt, zullen zij uw certificaat afgeven.

U heeft geen _Proxy Host_ nodig voordat u dit type certificaat aanvraagt. U hoeft uw _Proxy Host_ ook niet te laten configureren voor HTTP-toegang.

Dit proces ondersteunt _wel_ wildcard-domeinen.

#### Opgeslagen DNS-inloggegevens

De inloggegevens voor uw DNS-provider worden los van het certificaat opgeslagen, op het
tabblad _DNS-inloggegevens_ van de pagina Certificaten. Een certificaat kiest daarna alleen een van de
opgeslagen inloggegevens, zodat meerdere certificaten ze kunnen delen.

Geheimen worden versleuteld opgeslagen en nooit meer getoond. Laat bij het bewerken van inloggegevens
een geheim leeg om de opgeslagen waarde te behouden. De sleutel voor de versleuteling is het bestand
`/data/npmpro/dns-credentials.key`. Maak hiervan samen met de database een back-up, anders
kunnen de opgeslagen inloggegevens na een herstel niet worden gelezen.

Providers zonder formulier gebruiken het INI-tekstvak, waarin u de inhoud van het
inloggegevensbestand voor die provider plakt.

### Aangepast certificaat

Gebruik deze optie om uw eigen TLS-certificaat te uploaden, zoals verstrekt door uw eigen Certificaatautoriteit.
