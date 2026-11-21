## Certificati e TLS

Valori predefiniti per i certificati che NPMpro richiede al tuo server ACME (Let's Encrypt, a meno che tu ne imposti un altro con `ACME_SERVER`), per come vengono applicati con lo stapling e rinnovati, e per il certificato che risponde per gli host sconosciuti. Questa è la sezione delle Impostazioni, non la pagina con l'elenco dei Certificati.

Una variabile impostata sul container ha la precedenza sull'interfaccia e blocca il campo (il campo mostra un badge con il lucchetto, ad esempio "Impostato da ACME_KEY_TYPE"). Alcuni campi ne seguono un altro: un `ACME_KEY_SIZE` isolato che sia una curva ECDSA mantiene il tipo di chiave su ECDSA, e Must-Staple mantiene attivo l'OCSP stapling. Usa l'interfaccia per tutto ciò che non è impostato nel container.

### Account ACME

**Account ACME.** La scheda mostra la connessione alla tua autorità di certificazione (CA): Connesso, In attesa (la CA non era ancora raggiungibile), Non riuscito (con il messaggio della CA) o Non connesso. **Cambia** o **Connetti** apre una finestra in cui scegli la CA (Let's Encrypt, ZeroSSL, Google Trust Services o l'URL di directory di un'altra CA, https, non questo host), l'email e le chiavi EAB. ZeroSSL richiede un'email, Google un'email e chiavi EAB. **Connetti** registra l'account; una CA non raggiungibile può essere salvata comunque e si connette alla prossima richiesta di certificato. **Riprova** ritenta la connessione. Ogni CA ha il proprio account; i certificati restano presso la CA che li ha emessi finché non vengono riemessi. **Sostituisci account** è un pulsante accanto a **Cambia**: registra un nuovo account e vi sposta i certificati della CA; disattiva quello vecchio solo se la sua chiave è trapelata.

**Altre CA.** Sotto la connessione principale, questo elenco contiene gli account presso altre CA, una riga ciascuno con il suo stato e i suoi pulsanti (**Cambia**, **Riprova** o **Sostituisci account**, **Rimuovi**); **Aggiungi una CA** apre la stessa finestra. Ogni certificato viene richiesto alla CA scelta nella sua finestra e resta con essa. Solo gli amministratori aggiungono CA; chi può gestire i certificati sceglie tra queste. **Rimuovi** viene rifiutato finché l'istanza o un certificato usa la CA; l'account stesso resta presso la CA e i suoi file restano su disco.

### Richieste di certificato

Si applicano dalla prossima richiesta di certificato.

- **Tipo di chiave**: `ECDSA` (predefinito, consigliato: chiavi più piccole, handshake più rapidi) oppure `RSA` per i client che non possono usare ECDSA. Variabile: `ACME_KEY_TYPE`.
- **Dimensione della chiave**: la curva per ECDSA (`secp256r1`, `secp384r1`, `secp521r1`; predefinita `secp384r1`) o i bit per RSA (`2048`, `3072`, `4096`; predefinito `4096`). Variabile: `ACME_KEY_SIZE`.
- **Profilo ACME**: il profilo richiesto al server, verificato con il server al salvataggio. Se vuoto usa il valore predefinito del server. Con Let's Encrypt il valore predefinito è `shortlived`; i client che richiedono un Common Name non funzionano con i certificati `shortlived` e `tlsserver`. L'elenco mostra i profili offerti dalla CA; Predefinito del server lascia scegliere alla CA. Variabile: `ACME_PROFILE` (`none` per vuoto).
- **OCSP Must-Staple**: contrassegna i nuovi certificati come must-staple e mantiene attivo l'OCSP stapling. Solo per le CA che lo supportano (ZeroSSL); Let's Encrypt rifiuta queste richieste. Predefinito: attivo per Google Trust Services e ZeroSSL, altrimenti disattivato. Variabile: `ACME_MUST_STAPLE`.
- **Verifica il certificato del server ACME**: predefinito attivo. Disattivalo solo per un server ACME privato con certificato autofirmato. Variabile: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Entrambi si applicano dopo il reload di nginx eseguito dal salvataggio ed entrambi disattivano la compressione dei certificati TLS.

- **OCSP stapling per i certificati ACME**: invia la risposta OCSP con i certificati del server ACME, quando la CA offre OCSP. Predefinito: attivo per Google Trust Services e ZeroSSL, altrimenti disattivato. Variabile: `ACME_OCSP_STAPLING`.
- **OCSP stapling per i certificati personalizzati**: lo stesso per i certificati caricati. Predefinito: disattivato. Variabile: `CUSTOM_OCSP_STAPLING`.

### Certificato predefinito

- **Certificato per host sconosciuti e per l'interfaccia web**: viene servito per i nomi host per cui NPMpro non ha un host e sulla porta dell'interfaccia web. Predefinito: integrato, un segnaposto generato. Variabile: `DEFAULT_CERT_ID` (l'ID di un certificato; `0` è quello integrato). Si applica dopo il reload di nginx eseguito dal salvataggio.

### Rinnovo

- **Intervallo di controllo del rinnovo**: da 1 a 499 ore tra i controlli. Un certificato viene rinnovato solo alla scadenza. Predefinito: 3. Variabile: `CERTBOT_RUN_INTERVAL`. Si applica subito.

### ECH

- **Intervallo di rotazione delle chiavi ECH**: da 1 a 24 ore tra le esecuzioni del tuo script ECH (`/data/tls/ech/cron.sh`). Usato solo quando lo script non è vuoto. Predefinito: 1. Variabile: `ECH_ROTATION_INTERVAL`. Si applica subito.

Altro nel wiki: Security.
