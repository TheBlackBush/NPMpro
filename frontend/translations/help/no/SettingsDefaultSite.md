## Standardnettsted

Standardnettstedet er det nginx svarer med når en besøkende når NPMpro med et vertsnavn som ingen vert bruker, eller med serverens IP-adresse. Velg svaret her. Det gjelder alle ukjente navn.

Lagring tester det nye valget med nginx først. Hvis testen feiler, lagres ingenting, det forrige standardnettstedet blir stående og nginx-feilen står i containerloggen.

- **Gratulerer-side** (standard): viser velkomstsiden til NPMpro.
- **404-side**: svarer med en 404 Not Found-side.
- **Ingen respons (444)**: lukker tilkoblingen uten noe svar. Bruk den for å gi skannere ingenting å se. HTTPS-forespørsler for ukjente navn avvises under TLS-håndtrykket.
- **Omdirigering**: sender besøkende til en annen adresse med en midlertidig omdirigering (302). Skriv inn en full `http://`- eller `https://`-URL uten mellomrom, anførselstegn eller `; { } #`, på opptil 255 tegn.
- **Egendefinert HTML**: viser din egen HTML-side. **HTTP-statuskode** under den er valgfri, fra 400 til 599. La den stå tom for 200 (OK).

For alle valg unntatt Ingen respons omdirigeres forespørsler til ukjente navn over vanlig HTTP først til HTTPS, og HTTPS-forespørsler bruker sertifikatet som er valgt som **Standardsertifikat** i Innstillinger, Sertifikater og TLS.

Denne seksjonen har ingen miljøvariabler, så endringen tas i bruk når du lagrer.
