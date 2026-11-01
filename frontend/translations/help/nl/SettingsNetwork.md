## Netwerk

Geef NPMpro aan welke proxy's die ervoor staan het echte clientadres mogen doorgeven. Zonder dit zien logs, toegangslijsten en CrowdSec het adres van de proxy, niet dat van de bezoeker.

Een variabele die op de container is gezet, gaat voor op de interface en vergrendelt het veld (het veld toont een slotbadge zoals „Ingesteld door TRUST_IP”). Gebruik de interface voor alles wat niet in de container is ingesteld.

- **Vertrouwde proxy-IP's**: één IPv4- of IPv6-adres of CIDR-bereik per regel, bijvoorbeeld `10.0.0.0/8`, `192.168.1.5` of `fd00::/8`. Verzoeken van deze adressen mogen het echte client-IP doorgeven in `X-Forwarded-For`. Gebruik het voor een load balancer of tunnel direct voor NPMpro. Standaard: leeg (niemand wordt vertrouwd). Variabele: `TRUST_IP` (gescheiden door spaties). Geldt na de nginx-herlaadactie die het opslaan uitvoert.
- **Cloudflare vertrouwen**: haalt de IP-bereiken van Cloudflare op, ververst ze regelmatig en vertrouwt ze, zodat nginx achter Cloudflare de echte client-IP's ziet. Standaard: uit. Variabele: `TRUST_CLOUDFLARE`. Geldt na de nginx-herlaadactie die het opslaan uitvoert. Lees eerst de opmerkingen over Cloudflare in de wiki (Security): Cloudflare voor NPMpro zetten heeft kosten voor privacy en beveiliging.

Vertrouw alleen adressen die u beheert of volledig vertrouwt. Een vertrouwd adres kan beweren elke bezoeker te zijn.

Als het opslaan de nginx-test niet doorstaat, wordt niets opgeslagen en wordt de nginx-melding getoond.

Meer in de wiki: Security.
