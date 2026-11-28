## Wat is een toegangslijst?

Een toegangslijst beschermt proxy hosts. Ze kan bezoekers om een gebruikersnaam en wachtwoord vragen (Basic-authenticatie), bezoekers toelaten of weigeren op IP-adres, of beide. Dat helpt bij diensten zonder eigen login, of als u onbekende clients buiten wilt houden.

Eén lijst kan door veel proxy hosts en locaties worden gebruikt.

### Details

- **Naam**: verplicht.
- **Voldoen aan minstens een** (standaard uit): een bezoeker komt binnen als hij aan één controle voldoet, een regel of een geldige gebruiker. Uit betekent dat hij beide moet doorstaan. Het slaat ook een Auth-verzoek op die host over.
- **Authenticatie naar upstream doorgeven** (standaard uit): stuurt de `Authorization`-header van de bezoeker door naar de dienst. Uit houdt de login privé binnen NPMpro.

### Authorisaties

Voeg gebruikersnamen en wachtwoorden toe. Gebruikersnamen moeten uniek zijn binnen de lijst en mogen geen `:` bevatten. Als u een lijst bewerkt, laat u een opgeslagen wachtwoord leeg om het te behouden.

### Regels

Regels staan een IP-adres, een CIDR-bereik (`192.168.1.0/24`, `2001:db8::/32`) of `unix:` toe of weigeren het. Ze worden toegepast in de volgorde van de lijst, en de eerste treffer wint. Zet specifieke regels eerst. Een laatste `all`-regel sluit de lijst af, op toestaan of weigeren; ze wordt alleen toegevoegd als er minstens één andere regel is. Een lijst heeft minstens één gebruiker of één regel nodig.

### Gebruik bij proxy hosts

Kies bij een proxy host de lijst onder **Globale toegangslijst** op het tabblad Details: **Publiekelijk toegankelijk** (geen lijst) of **Aangepast**. Een aangepaste locatie kan **Globaal** (de lijsten van de host), **Publiekelijk toegankelijk** of lijsten van het type **Aangepast** gebruiken.

U kunt meerdere lijsten aan één host of locatie koppelen. Ze worden van boven naar beneden gecontroleerd, in de getoonde volgorde, en u kunt ze omhoog en omlaag verplaatsen. **Voldoen aan minstens een** en **Authenticatie naar upstream doorgeven** tellen alleen bij de eerste lijst. Met CrowdSec zien geblokkeerde IP's de blokkadepagina vóór de wachtwoordvraag.

Meer in de wiki: Host options.

### Weigerpagina

**Geweigerd** (401, 403) is wat een bezoeker ziet wanneer de lijst hem weigert (niet op hosts met forward-authenticatie): **Globale instelling** (de pagina van Instellingen, Landingspagina's), de **Pagina ‘Toegang geweigerd’**, een **Aangepaste pagina** alleen voor deze lijst (plak of upload één HTML-bestand) of **De gewone pagina van nginx**, die die van nginx behoudt.

### Landen

Sta bezoekers toe of blokkeer ze op basis van hun land. **Landregels** is **Uit**, **Alleen deze landen toestaan** of **Deze landen blokkeren**; voeg landen toe met **Een land toevoegen** (zoek op de naam van het land in de taal van de interface of op de code van twee letters) en geef elk land een optionele opmerking. Een lijst in een toestaan- of blokkeermodus heeft minstens één land nodig.

- **Bezoekers blokkeren van wie het land onbekend is** gaat over openbare adressen waarvoor de GeoIP-database geen land heeft. De toestaanmodus blokkeert ze standaard, de blokkeermodus laat ze door.
- **De verbinding sluiten zonder antwoord (444)** geldt alleen voor bezoekers die op land zijn geblokkeerd. Weigeringen op IP en wachtwoord houden de weigerpagina.
- Privé- en lokale adressen komen altijd door. Landen worden gecontroleerd vóór de IP- en wachtwoordregels, ook bij **Voldoen aan minstens een**.
- Landregels hebben een GeoIP-landendatabase nodig (Instellingen, GeoIP). Zonder database, of zolang nginx de databaseregel weigert, komt elke bezoeker door: opgeslagen landen blijven bewaard, maar een lijst kan geen nieuwe modus of nieuwe landen krijgen tot er een database beschikbaar is.
