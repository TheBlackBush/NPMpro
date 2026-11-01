## Netzwerk

Sagen Sie NPMpro, welchen davorliegenden Proxys es bei der echten Client-Adresse glauben darf. Ohne das sehen Logs, Zugriffslisten und CrowdSec die Adresse des Proxys, nicht die des Besuchers.

Eine am Container gesetzte Variable hat Vorrang vor der Oberfläche und sperrt das Feld (das Feld zeigt ein Schloss-Badge wie „Gesetzt durch TRUST_IP“). Verwenden Sie die Oberfläche für alles, was nicht im Container gesetzt ist.

- **Vertrauenswürdige Proxy-IPs**: eine IPv4- oder IPv6-Adresse oder ein CIDR-Bereich pro Zeile, zum Beispiel `10.0.0.0/8`, `192.168.1.5` oder `fd00::/8`. Anfragen von diesen Adressen dürfen die echte Client-IP in `X-Forwarded-For` übergeben. Verwenden Sie es für einen Load Balancer oder Tunnel direkt vor NPMpro. Standard: leer (niemandem wird vertraut). Variable: `TRUST_IP` (durch Leerzeichen getrennt). Gilt nach dem nginx-Reload, den das Speichern auslöst.
- **Cloudflare vertrauen**: ruft die IP-Bereiche von Cloudflare ab, aktualisiert sie regelmäßig und vertraut ihnen, sodass nginx hinter Cloudflare die echten Client-IPs sieht. Standard: aus. Variable: `TRUST_CLOUDFLARE`. Gilt nach dem nginx-Reload, den das Speichern auslöst. Lesen Sie zuerst die Hinweise zu Cloudflare im Wiki (Security): Cloudflare vor NPMpro zu setzen hat Kosten für Datenschutz und Sicherheit.

Vertrauen Sie nur Adressen, die Sie kontrollieren oder auf die Sie sich voll verlassen. Eine vertrauenswürdige Adresse kann behaupten, jeder beliebige Besucher zu sein.

Schlägt das Speichern am nginx-Test fehl, wird nichts gespeichert, und die nginx-Meldung wird angezeigt.

Mehr im Wiki: Security.
