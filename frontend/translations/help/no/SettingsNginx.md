## nginx

Innstillinger for selve nginx som gjelder alle verter: hvor mange workere den kjører, TLS-regler og valgfrie moduler. Lagring tester konfigurasjonen og laster nginx på nytt. En konfigurasjon som feiler testen, tas ikke i bruk.

En variabel satt på containeren vinner over brukergrensesnittet og låser feltet (feltet viser et låsemerke som «Satt av NGINX_WORKER_PROCESSES»). Bruk brukergrensesnittet for alt som ikke er satt i containeren. Alle innstillinger her tas i bruk etter nginx-omlastingen som lagringen kjører.

### Workere

- **Worker-prosesser**: «Automatisk (én per CPU-tråd)» eller et tall opp til antall CPU-tråder containeren ser. Standard: én per tråd, høyst 4. Variabel: `NGINX_WORKER_PROCESSES`.
- **Tilkoblinger per worker**: åpne tilkoblinger hver worker håndterer samtidig, 64 til 65535. Standard: 512. Variabel: `NGINX_WORKER_CONNECTIONS`.
- **Tidsavbrudd for avslutning av workere**: hvor lenge gamle workere beholder tilkoblingene sine etter en omlasting. En nginx-tidsverdi som `30s`, `10m` eller `1h`. `0` betyr ingen grense. Standard: `1h`. Variabel: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Logging

- **Logg feil for filer som ikke finnes**: skriver en feillogglinje for hver forespørsel etter en fil som mangler. Standard: av. Variabel: `NGINX_LOG_NOT_FOUND`.

### TLS for alle verter

Hvis du slår av TLS 1.2 eller NIST P-kurvene, stenges eldre nettlesere og klienter ute. TLS 1.3 er alltid på.

- **Tillat TLS 1.2**: standard på. Variabel: `NGINX_DISABLE_TLS12` (invertert: `true` slår av TLS 1.2).
- **Bare post-kvante-nøkkelutveksling**: tillater bare X25519MLKEM768, som krever en nyere klient. Den slår av TLS 1.2 og NIST P-kurvene og låser dem mens den er på. Standard: av. Variabel: `NGINX_FORCE_X25519MLKEM768`.
- **Tillat NIST P-kurvene**: secp521r1, secp384r1 og prime256v1 for nøkkelutvekslingen, ved siden av X25519. Standard: på. Variabel: `NGINX_TRUST_SECPR1`.
- **Tillat RSA PKCS#1-signaturer**: for gamle klienter som ikke kan bruke RSA-PSS. Standard: av. Variabel: `NGINX_TRUST_RSA_PKCS1`.

### Moduler

Alle er av som standard. Slå på en modul bare når en egendefinert konfigurasjon av din trenger den. Hvis du slår av en modul mens en egendefinert konfigurasjon fortsatt bruker den, feiler nginx-testen.

- **njs (JavaScript)**: `js_*`-direktiver. Variabel: `NGINX_LOAD_NJS_MODULE`.
- **LDAP-autentisering**: `auth_ldap`-direktiver. Variabel: `NGINX_LOAD_LDAP_MODULE`.
- **NTLM-upstreams**: `ntlm` i upstream-blokker. Variabel: `NGINX_LOAD_NTLM_MODULE`.
- **Trafikkstatus for virtuelle verter**: `vhost_traffic_status_*`-direktiver. Variabel: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Mer i wikien: Configuration.
