## Nettverk

Fortell NPMpro hvilke proxyer foran den som kan stoles på når det gjelder den virkelige klientadressen. Uten dette ser logger, tilgangslister og CrowdSec adressen til proxyen, ikke til den besøkende.

En variabel satt på containeren vinner over brukergrensesnittet og låser feltet (feltet viser et låsemerke som «Satt av TRUST_IP»). Bruk brukergrensesnittet for alt som ikke er satt i containeren.

- **Klarerte proxy-IP-er**: én IPv4- eller IPv6-adresse eller ett CIDR-område per linje, for eksempel `10.0.0.0/8`, `192.168.1.5` eller `fd00::/8`. Forespørsler fra disse adressene kan sende den virkelige klient-IP-en i `X-Forwarded-For`. Bruk den for en lastbalanserer eller tunnel rett foran NPMpro. Standard: tom (ingen stoles på). Variabel: `TRUST_IP` (adskilt med mellomrom). Tas i bruk etter nginx-omlastingen som lagringen kjører.
- **Stol på Cloudflare**: henter Cloudflares IP-områder, oppdaterer dem jevnlig og stoler på dem, så nginx ser de virkelige klient-IP-ene bak Cloudflare. Standard: av. Variabel: `TRUST_CLOUDFLARE`. Tas i bruk etter nginx-omlastingen som lagringen kjører. Les merknadene om Cloudflare i wikien (Security) først: å sette Cloudflare foran NPMpro har kostnader for personvern og sikkerhet.

Stol bare på adresser du styrer eller stoler helt på. En klarert adresse kan påstå å være hvilken som helst besøkende.

Hvis lagringen feiler nginx-testen, lagres ingenting, og nginx-meldingen vises.

Mer i wikien: Security.
