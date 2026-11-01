## Che cos'è un Redirection Host?

Un Redirection Host manda i visitatori di un dominio a un altro indirizzo. Usalo quando un sito cambia dominio e i vecchi link devono continuare a funzionare, oppure per inviare `www` al nome principale.

Usa **Duplica** nel menu dell'host per copiare un host in una nuova finestra di aggiunta. La copia parte senza i nomi di dominio, perché un dominio può appartenere a un solo host attivo.

### Dettagli

- **Nomi di Dominio**: i nomi che vengono reindirizzati. Obbligatorio. I caratteri jolly sono consentiti per un nuovo certificato solo con la challenge DNS.
- **Schema**: lo schema della destinazione. "mantieni (come la richiesta)" è il valore predefinito e mantiene `http` o `https` della visita. Oppure scegli `http` o `https`.
- **Dominio di Destinazione**: il dominio a cui vengono inviati i visitatori, ad esempio `example.com`. Obbligatorio.
- **Codice HTTP**: il codice di risposta. Predefinito 301 Moved permanently. Altre scelte: 302 Moved temporarily, 303 See other, 307 Temporary redirect e 308 Permanent redirect. Usa 301 o 308 quando lo spostamento è definitivo; browser e motori di ricerca li ricordano.
- **Gruppo**: un'etichetta libera che tiene in ordine gli elenchi lunghi. Scegline una in uso o scrivi un nuovo nome.
- **Preserva Percorso** (disattivato per impostazione predefinita): aggiunge alla destinazione il percorso e la query originali. Con questa opzione, `old.example/a?b=1` va a `new.example/a?b=1`. Senza, ogni visitatore arriva all'inizio della destinazione.

### TLS

- **Certificato TLS**: Nessuno, Richiedi un nuovo certificato, oppure uno esistente. Le opzioni qui sotto richiedono un certificato.
- **Certificato mTLS**: una autorità di certificazione client. **Rendi mTLS facoltativo** fa entrare anche i visitatori senza certificato client.
- **Forza HTTPS**: reindirizza prima HTTP a HTTPS.
- **Supporto HTTP/3**: consente HTTP/3 (QUIC).
- **HSTS abilitato (2 anni)**: richiede Forza HTTPS. **HSTS sottodomini + preload** richiede HSTS.
- Per un nuovo certificato: **Riusa la chiave (sconsigliato)** e **Usa Challenge DNS**, con provider, credenziale e secondi di propagazione.

Tutte le opzioni TLS sono disattivate per impostazione predefinita.

### Avanzate

Configurazione nginx personalizzata aggiunta all'interno del blocco server dell'host. Solo gli amministratori possono modificarla; gli altri utenti la vedono in sola lettura.

Altro nel wiki: Host options.
