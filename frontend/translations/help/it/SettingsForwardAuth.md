## Autenticazione delegata

L'autenticazione delegata mette un login o un controllo anti-bot davanti a un host proxy. Per ogni richiesta, nginx chiede prima a un servizio di autenticazione se il visitatore può passare. NPMpro lo supporta in modo integrato per Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia e Authentik. Il provider lo esegui tu nel suo container.

Questa pagina imposta l'indirizzo predefinito (upstream) di ogni provider. Un host proxy attiva il controllo con **Auth Request** sotto Opzioni nella scheda Dettagli (o in un percorso personalizzato).

Una variabile impostata sul container ha la precedenza sull'interfaccia e blocca il campo (il campo mostra un badge con il lucchetto, ad esempio "Impostato da AUTH_REQUEST_AUTHELIA_UPSTREAM"). Usa l'interfaccia per tutto ciò che non è impostato nel container. Ogni impostazione qui si applica dopo il reload di nginx eseguito dal salvataggio. Se il test di nginx fallisce, non viene salvato nulla.

### Upstream predefiniti

- **Upstream Anubis**, **Upstream Tinyauth**, **Upstream OAuth2 Proxy**, **Upstream VoidAuth**, **Upstream Authelia**, **Upstream Authentik**: usati dagli host proxy con quel provider che non hanno un upstream proprio. Il valore dell'host vince. Predefinito: vuoto (nessuno). Variabili: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Formato: `scheme://host:port`, ad esempio `http://127.0.0.1:9091`, oppure `scheme://cu_name` per un tuo blocco upstream di nginx il cui nome inizia con `cu_`. Usa `http` o `https`; la porta è obbligatoria; un indirizzo IPv6 va tra parentesi quadre. Nessun percorso, nessuno spazio e nessuno tra `; { } # " ' $ \`.

Non puoi svuotare un valore predefinito finché degli host proxy usano quel provider senza un upstream proprio. Il messaggio elenca quegli host.

Un host che usa un provider senza upstream in nessun posto riceve un "Errore di configurazione".

### Anubis

- **Immagini Anubis personalizzate**: mostra le tue `happy.webp`, `reject.webp` e `pensive.webp` nelle pagine di verifica di Anubis. Predefinito: attivo quando tutti e tre i file esistono e non sono vuoti, altrimenti disattivato. Variabile: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. Le immagini vanno in `public/anubis` nella tua cartella dati.

Altro nel wiki: Forward-Authentication.
