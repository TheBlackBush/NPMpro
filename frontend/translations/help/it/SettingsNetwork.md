## Rete

Indica a NPMpro di quali proxy davanti a esso ci si può fidare per l'indirizzo reale del client. Senza questa impostazione, log, liste di accesso e CrowdSec vedono l'indirizzo del proxy, non quello del visitatore.

Una variabile impostata sul container ha la precedenza sull'interfaccia e blocca il campo (il campo mostra un badge con il lucchetto, ad esempio "Impostato da TRUST_IP"). Usa l'interfaccia per tutto ciò che non è impostato nel container.

- **IP dei proxy affidabili**: un indirizzo IPv4 o IPv6 o un intervallo CIDR per riga, ad esempio `10.0.0.0/8`, `192.168.1.5` o `fd00::/8`. Le richieste da questi indirizzi possono passare l'IP reale del client in `X-Forwarded-For`. Usalo per un load balancer o un tunnel direttamente davanti a NPMpro. Predefinito: vuoto (non ci si fida di nessuno). Variabile: `TRUST_IP` (separata da spazi). Si applica dopo il reload di nginx eseguito dal salvataggio.
- **Considera affidabile Cloudflare**: scarica gli intervalli IP di Cloudflare, li aggiorna regolarmente e se ne fida, così nginx vede gli IP reali dei client dietro Cloudflare. Predefinito: disattivato. Variabile: `TRUST_CLOUDFLARE`. Si applica dopo il reload di nginx eseguito dal salvataggio. Leggi prima le note su Cloudflare nel wiki (Security): mettere Cloudflare davanti a NPMpro ha costi di privacy e sicurezza.

Considera affidabili solo indirizzi che controlli o di cui ti fidi completamente. Un indirizzo affidabile può dichiararsi qualsiasi visitatore.

Se il salvataggio non supera il test di nginx, non viene salvato nulla e viene mostrato il messaggio di nginx.

Altro nel wiki: Security.
