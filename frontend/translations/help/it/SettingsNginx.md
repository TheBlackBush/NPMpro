## nginx

Impostazioni di nginx stesso che valgono per tutti gli host: quanti worker esegue, regole TLS e moduli opzionali. Il salvataggio prova la configurazione e ricarica nginx. Una configurazione che non supera il test non viene applicata.

Una variabile impostata sul container ha la precedenza sull'interfaccia e blocca il campo (il campo mostra un badge con il lucchetto, ad esempio "Impostato da NGINX_WORKER_PROCESSES"). Usa l'interfaccia per tutto ciò che non è impostato nel container. Ogni impostazione qui si applica dopo il reload di nginx eseguito dal salvataggio.

### Worker

- **Processi worker**: "Automatico (uno per thread della CPU)" oppure un numero fino ai thread della CPU che il container vede. Predefinito: uno per thread, al massimo 4. Variabile: `NGINX_WORKER_PROCESSES`.
- **Connessioni per worker**: connessioni aperte che ogni worker gestisce contemporaneamente, da 64 a 65535. Predefinito: 512. Variabile: `NGINX_WORKER_CONNECTIONS`.
- **Timeout di arresto dei worker**: per quanto tempo i vecchi worker mantengono le loro connessioni dopo un reload. Un valore di tempo di nginx come `30s`, `10m` o `1h`; `0` significa nessun limite. Predefinito: `1h`. Variabile: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Registrazione

- **Registra gli errori di file non trovato**: scrive una riga nel log degli errori per ogni richiesta di un file mancante. Predefinito: disattivato. Variabile: `NGINX_LOG_NOT_FOUND`.

### TLS per tutti gli host

Disattivare TLS 1.2 o le curve NIST P esclude browser e client più vecchi. TLS 1.3 è sempre attivo.

- **Consenti TLS 1.2**: predefinito attivo. Variabile: `NGINX_DISABLE_TLS12` (invertita: `true` disattiva TLS 1.2).
- **Solo scambio di chiavi post-quantistico**: consente solo X25519MLKEM768, che richiede un client recente. Disattiva TLS 1.2 e le curve NIST P e le blocca finché è attivo. Predefinito: disattivato. Variabile: `NGINX_FORCE_X25519MLKEM768`.
- **Consenti le curve NIST P**: secp521r1, secp384r1 e prime256v1 per lo scambio di chiavi, accanto a X25519. Predefinito: attivo. Variabile: `NGINX_TRUST_SECPR1`.
- **Consenti le firme RSA PKCS#1**: per i vecchi client che non possono usare RSA-PSS. Predefinito: disattivato. Variabile: `NGINX_TRUST_RSA_PKCS1`.

### Moduli

Tutti disattivati per impostazione predefinita. Attiva un modulo solo quando una tua configurazione personalizzata ne ha bisogno. Disattivarne uno mentre una configurazione personalizzata lo usa ancora fa fallire il test di nginx.

- **njs (JavaScript)**: direttive `js_*`. Variabile: `NGINX_LOAD_NJS_MODULE`.
- **Autenticazione LDAP**: direttive `auth_ldap`. Variabile: `NGINX_LOAD_LDAP_MODULE`.
- **Upstream NTLM**: `ntlm` nei blocchi upstream. Variabile: `NGINX_LOAD_NTLM_MODULE`.
- **Stato del traffico degli host virtuali**: direttive `vhost_traffic_status_*`. Variabile: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Altro nel wiki: Configuration.
