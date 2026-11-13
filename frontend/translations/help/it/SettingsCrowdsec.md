## CrowdSec

Collega il bouncer CrowdSec integrato in NPMpro al tuo container CrowdSec. Ogni richiesta ai tuoi host viene controllata in base alle decisioni della Local API di CrowdSec (LAPI) e, con un URL di AppSec, in base alle regole di AppSec. Il salvataggio applica subito le impostazioni con un ricaricamento di nginx; il container non viene riavviato.

NPMpro scrive `/data/crowdsec/crowdsec.conf` a partire da queste impostazioni. Le modifiche manuali a quel file vengono sovrascritte. `ban.html` e `captcha.html` nella stessa cartella puoi modificarli tu.

Una variabile impostata sul container ha la precedenza sull'interfaccia e blocca il campo: `CROWDSEC_ENABLED`, `CROWDSEC_LAPI_URL`, `CROWDSEC_API_KEY`, `CROWDSEC_APPSEC_URL`.

### Stato e Verifica connessione

Mostra se nginx carica il bouncer e quando NPMpro ha raggiunto la LAPI l'ultima volta. **Verifica connessione** controlla i valori del modulo: una richiesta di decisioni alla LAPI con la chiave (o il certificato client TLS) e, con un URL di AppSec, una richiesta ad AppSec. Un campo chiave lasciato vuoto usa la chiave salvata.

Salvando con il bouncer attivo viene eseguito prima lo stesso test. Se fallisce, vengono mostrati i motivi e **Salva comunque** salva ugualmente, ad esempio quando CrowdSec non è ancora in esecuzione.

**Salva comunque** non viene offerto quando AppSec fallisce, **Quando AppSec non è raggiungibile** è su **Rifiuta la richiesta** e l'interfaccia di amministrazione è controllata, perché quel salvataggio ti chiuderebbe fuori dall'interfaccia di amministrazione: correggi la **Chiave API** o l'**URL di AppSec**, imposta l'azione in caso di errore su **Lascia passare la richiesta**, oppure attiva **Escludi l'interfaccia di amministrazione da CrowdSec**.

### Connessione

- **Attiva il bouncer**: controlla ogni richiesta.
- **URL della LAPI**: ad esempio `http://127.0.0.1:8080`.
- **Chiave API**: ottenuta con `docker exec crowdsec cscli bouncers add npmpro`. Memorizzata cifrata e non più mostrata. **Rimuovi la chiave salvata** la elimina.
- **Certificato client TLS**: al posto della chiave, un file di certificato e uno di chiave in `/data/crowdsec/`; richiede un URL LAPI `https://`. Quando è impostato un URL AppSec, il campo **Chiave API** viene mostrato ed è obbligatorio anche con un certificato client TLS, perché AppSec si autentica con la chiave API; senza di essa AppSec rifiuta ogni richiesta.
- **Verifica i certificati TLS**: controlla il certificato di un URL https della LAPI o di AppSec.

### Blocco

- **Modalità**: live interroga la LAPI per ogni IP client e memorizza la risposta nella cache per i secondi indicati; stream scarica tutte le decisioni all'intervallo indicato.
- **Risposta a un ban**: la pagina di ban (con un codice di stato facoltativo, 403 per impostazione predefinita), un reindirizzamento o un codice di stato senza pagina.
- **Rimedio di riserva** e **Tipi di decisione**: come vengono gestite le decisioni che il bouncer non può applicare e quali tipi vengono applicati.
- **Escludi l'interfaccia di amministrazione da CrowdSec**: le richieste all'interfaccia di amministrazione ignorano il bouncer e AppSec. Attivalo prima di usare AppSec con il rifiuto, così un'interruzione di CrowdSec non può bloccarti fuori.

### Captcha

Il provider (reCAPTCHA, hCaptcha, Cloudflare Turnstile), la sua chiave del sito e la chiave segreta, e per quanto tempo un captcha risolto resta valido. Usato per le decisioni di tipo captcha.

### AppSec

- **URL di AppSec**: ad esempio `http://127.0.0.1:7422`; vuoto disattiva AppSec.
- **Quando AppSec non è raggiungibile**: rifiuta blocca ogni richiesta controllata finché AppSec non è raggiungibile; lascia passare le lascia senza controllo.

### Avanzate

Il timeout delle richieste alla LAPI, i filtri degli scenari, i percorsi esclusi, le richieste interne, i timeout e le opzioni di AppSec, e i file delle pagine di ban e captcha con un'**Anteprima**.

### Bloccato fuori?

Avvia di nuovo CrowdSec, oppure imposta `CROWDSEC_ENABLED=false` sul container e ricrealo; poi correggi le impostazioni qui.

Altro nel wiki: CrowdSec.
