## Standaard site

De standaardsite is wat nginx antwoordt als een bezoeker NPMpro bereikt met een hostnaam die geen enkele host gebruikt, of met het IP-adres van de server. Kies hier het antwoord. Het geldt voor alle onbekende namen.

Bij het opslaan wordt de nieuwe keuze eerst met nginx getest. Mislukt de test, dan wordt niets opgeslagen, blijft de vorige standaardsite staan en staat de nginx-fout in het containerlog.

- **Felicitatiepagina** (standaard): toont de welkomstpagina van NPMpro.
- **404-pagina**: antwoordt met een pagina 404 Not Found.
- **Geen respons (444)**: sluit de verbinding zonder enig antwoord. Gebruik het om scanners niets te laten zien. HTTPS-verzoeken voor onbekende namen worden tijdens de TLS-handshake geweigerd.
- **Omleiden**: stuurt bezoekers met een tijdelijke omleiding (302) naar een ander adres. Voer een volledige `http://`- of `https://`-URL in zonder spaties, aanhalingstekens of `; { } #`, tot 255 tekens.
- **Aangepaste HTML**: toont uw eigen HTML-pagina. De **HTTP-code** eronder is optioneel, van 400 tot 599. Laat leeg voor 200 (OK).

Bij elke keuze behalve Geen respons worden verzoeken naar onbekende namen via gewoon HTTP eerst omgeleid naar HTTPS, en HTTPS-verzoeken gebruiken het certificaat dat is gekozen als **Standaardcertificaat** in Instellingen, Certificaten en TLS.

Deze sectie heeft geen omgevingsvariabelen, dus de wijziging geldt zodra u opslaat.
