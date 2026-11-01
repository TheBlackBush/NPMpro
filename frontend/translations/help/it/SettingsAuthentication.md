## Autenticazione

Accesso all'interfaccia web di NPMpro con un provider OIDC (ad esempio Authentik, Keycloak o Google), in aggiunta o al posto delle password. Non è l'autenticazione delegata: non protegge i tuoi host proxy. Per quella vedi Impostazioni, Autenticazione delegata.

Una variabile impostata sul container ha la precedenza sull'interfaccia e blocca il campo (il campo mostra "Impostato dall'ambiente"). Se le quattro variabili di connessione sono tutte impostate, OIDC è attivo senza abilitarlo nell'interfaccia. Usa l'interfaccia per tutto ciò che non è impostato nel container. Tutto ciò che trovi qui si applica quando salvi.

### Provider

- **Abilita l'accesso con OIDC**: mostra il pulsante di accesso nella pagina di login.
- **URL dell'emittente**: l'indirizzo base di discovery del provider, ad esempio `https://accounts.example.com`. Variabile: `OIDC_ISSUER_URL`.
- **Client ID** e **Client secret**: forniti dal tuo provider. Il secret è memorizzato cifrato e non viene più mostrato; lascialo vuoto per mantenerlo. Se cambi l'URL dell'emittente o il client ID, inserisci di nuovo il secret. Variabili: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Dominio di reindirizzamento**: il dominio che usi per aprire NPMpro, con la porta se non è la 443. Obbligatorio, perché serve a costruire l'URL di callback. Variabile: `OIDC_REDIRECT_DOMAIN`.
- **URL di callback**: sola lettura. Registralo come URI di reindirizzamento presso il tuo provider.
- **Scope**: predefinito `openid email profile`. Cambialo se il tuo provider ne consente solo alcuni, ad esempio `openid email`.
- **Verifica connessione**: controlla che NPMpro riesca a raggiungere l'emittente.

### Pulsante di accesso

Il pulsante nella pagina di accesso: **Nome visualizzato** (il testo dopo "Accedi con"), **Colore** (un preset o il tuo `#rrggbb`) e **Icona** (integrata, caricata come PNG, JPEG, WebP o SVG fino a 256 KB, oppure scaricata da un URL). Viene mostrata un'anteprima.

### Regole di accesso

- **Richiedi un'e-mail verificata**: rifiuta gli utenti la cui e-mail non è stata verificata dal provider. Predefinito: attivo. Variabile: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Salta il secondo fattore dopo OIDC**: si fida del controllo multifattore del provider. Predefinito: disattivato. Variabile: `OIDC_SKIP_MFA`.
- **Disattiva accesso con password**: può accedere solo OIDC. Puoi attivarlo solo da una sessione avviata con OIDC. Variabile: `OIDC_DISABLE_PASSWORD`; per ripristinare l'accesso con password impostala su `false` e ricrea il container.

### Nuovi utenti

- **Crea gli utenti al loro primo accesso** (predefinito: disattivato): chi non ha un account ne riceve uno con i permessi indicati sotto.
- **Domini e-mail consentiti**: separati da virgola; vuoto consente qualsiasi dominio. Con un elenco vuoto e senza e-mail verificata obbligatoria, chiunque il tuo provider accetti ottiene un account.
- **Permessi predefiniti per i nuovi utenti**: impostati per sezione. I nuovi utenti non sono mai amministratori.

Altro nel wiki: Authentication.
