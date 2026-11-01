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
