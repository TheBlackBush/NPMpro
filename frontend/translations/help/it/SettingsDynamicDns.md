## DNS dinamico

Come NPMpro mantiene i record della scheda DNS dinamico (Certificati) puntati al suo indirizzo pubblico. Non viene controllato nulla finché un record non è abilitato.

Una variabile impostata sul container ha la precedenza sull'interfaccia e blocca il campo (il campo mostra un badge con lucchetto come "Impostato da DDNS_PERIOD"). Usa l'interfaccia per tutto ciò che non è impostato nel container.

- **Controlla ogni**: ogni quanto vengono controllati i record, da `1m` a `24h` (ad esempio `5m` o `1h30m`). Predefinito: `5m`. Variabile: `DDNS_PERIOD`. Una modifica riavvia il timer.
- **Intervallo minimo**: il tempo minimo tra due scritture di uno stesso record, nello stesso formato. Predefinito: `5m`. Variabile: `DDNS_COOLDOWN`.
- **Servizi di indirizzo IPv4** e **Servizi di indirizzo IPv6**: da 2 a 10 URL `https://` che rispondono con l'indirizzo pubblico. Un nuovo indirizzo viene scritto solo quando un secondo servizio lo conferma; un indirizzo invariato è accettato da uno solo. I servizi IPv6 vengono interrogati solo finché un record abilitato richiede IPv6. Variabili: `DDNS_IPV4_SERVICES`, `DDNS_IPV6_SERVICES` (separate da spazi). Un servizio su questo host, su un indirizzo link-local (come i metadati del cloud) o su un indirizzo multicast o riservato viene rifiutato; gli indirizzi della rete locale privata sono ammessi.
- **Server DNS per i controlli**: usati solo per risolvere il nome di un record prima di interrogare il provider (split horizon); i servizi di indirizzo e i provider usano sempre i resolver del container. Vuoto usa anche qui i resolver del container. Un indirizzo IPv4, oppure un indirizzo IPv6 tra parentesi quadre, con una porta facoltativa. Variabile: `DDNS_RESOLVER` (separati da spazi).

I record si aggiungono nella scheda DNS dinamico con una credenziale DNS di un provider in grado di aggiornare i record.
