## Che cos'è un Proxy Host?

Un Proxy Host è la porta d'ingresso di un servizio web. I visitatori aprono il tuo dominio in NPMpro e NPMpro inoltra la richiesta al servizio che sta dietro. Può anche aggiungere TLS (HTTPS) ai servizi che non ne hanno uno proprio. I Proxy Host sono l'uso più comune di NPMpro.

Usa **Duplica** nel menu dell'host per copiare un host in una nuova finestra di aggiunta. La copia parte senza i nomi di dominio, perché un dominio può appartenere a un solo host attivo.

### Dettagli

- **Nomi di Dominio**: i nomi usati dai visitatori. Obbligatorio. Per un nuovo certificato, i caratteri jolly (`*.example.com`) richiedono la challenge DNS.
- **Schema**: come NPMpro parla con il servizio: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (serve file o PHP da una cartella) oppure `empty` (nessun upstream). Predefinito `http://`. Cambiando lo schema si disattivano le opzioni che non vi si adattano.
- **Hostname / IP / path di destinazione**: l'indirizzo del servizio. Puoi aggiungere un sottopercorso, ad esempio `127.0.0.1/path`. Con `path`, inserisci invece una cartella. Monta i tuoi file sotto `/var/www`; solo gli amministratori possono usare una cartella al di fuori. Un nome che inizia con `cu_` indica un tuo blocco upstream di nginx (vedi Load balancing nel wiki).
- **Porta di Destinazione**: facoltativa. Con `path` è la versione di PHP.
- **Gruppo**: un'etichetta libera che tiene in ordine gli elenchi lunghi.
- **Opzioni** (tutte disattivate per impostazione predefinita):
  - **Invia l'header noindex e blocca alcuni user agent di bot**: chiede ai motori di ricerca di non indicizzare il sito e blocca alcuni crawler.
  - **Disattiva CrowdSec AppSec**: disattiva CrowdSec AppSec solo per questo host. Ha effetto solo se AppSec è configurato.
  - **Disattiva il buffering delle richieste** e **Disattiva il buffering delle risposte**: per gli upstream http e https. Lascia il buffering attivo, a meno che tu non faccia streaming o upload di file grandi su un collegamento veloce e stabile. Disattivare il buffering delle richieste disattiva anche AppSec.
  - **Attiva la compressione da parte dell'upstream**: lascia che il servizio comprima da sé le proprie risposte. Lascia disattivato se il servizio non lo richiede. Non per `path` ed `empty`.
  - **Attiva fancyindex**: mostra l'elenco dei file quando una cartella non ha un file indice. Solo per `path`.
- **X-Frame-Options**: `SAMEORIGIN` (predefinito), `DENY`, `none` (rimuove l'header) oppure `upstream` (mantiene ciò che invia il servizio).
- **Auth Request**: mette un login o un controllo anti-bot davanti all'host (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Predefinito `none`. **Upstream Auth Request** è facoltativo; se vuoto usa il valore predefinito di Impostazioni, Autenticazione delegata.
- **Liste di accesso globali**: **Accessibile Pubblicamente** (predefinito, senza login) oppure **Personalizzata**, una o più Access List.

I websocket sono sempre attivi.

### Percorsi Personalizzati

Un percorso (location) invia un percorso dell'host (ad esempio `/api/`) a un altro servizio. Ognuno ha **Abilitato**, un percorso con un tipo di corrispondenza facoltativo (`=`, `~`, `~*`, `^~` o `@`), un proprio schema, host, porta, opzioni, Auth Request e liste di accesso. La sua lista di accesso può essere **Globale**, che usa le liste dell'host. Non eredita l'Auth Request dell'host. Aggiungi una barra finale al percorso, a meno che tu non voglia la corrispondenza per prefisso. Gli amministratori possono aggiungere una configurazione nginx personalizzata per ogni percorso con il pulsante a forma di ingranaggio.

### TLS

- **Certificato TLS**: Nessuno, Richiedi un nuovo certificato, oppure uno esistente. Le opzioni qui sotto richiedono un certificato.
- **Certificato mTLS**: una autorità di certificazione client. **Rendi mTLS facoltativo** fa entrare anche i visitatori senza certificato. **mTLS salta Auth Request** permette ai visitatori con un certificato valido di saltare l'Auth Request.
- **Forza HTTPS** reindirizza HTTP a HTTPS. **Supporto HTTP/3** consente HTTP/3 (QUIC).
- **HSTS abilitato (2 anni)**: richiede Forza HTTPS. **HSTS sottodomini + preload** richiede HSTS.
- Per un nuovo certificato: **Riusa la chiave (sconsigliato)** e **Usa Challenge DNS**, con provider, credenziale e secondi di propagazione.

### Avanzate

Configurazione nginx personalizzata per l'intero host (blocco server) e per la location principale `location /`. Solo gli amministratori possono modificarla.

Altro nel wiki: Host options.
