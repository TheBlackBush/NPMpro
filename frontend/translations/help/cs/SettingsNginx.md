## nginx

Nastavení samotného nginx, která platí pro všechny hostitele: kolik workerů spouští, pravidla TLS a volitelné moduly. Uložení otestuje konfiguraci a znovu načte nginx. Konfigurace, která test nepřejde, se nepoužije.

Proměnná nastavená na kontejneru má přednost před rozhraním a zamkne pole (pole ukazuje odznak se zámkem, například "Nastaveno přes NGINX_WORKER_PROCESSES"). Rozhraní používejte pro vše, co není nastaveno na kontejneru. Každé nastavení zde se použije po reloadu nginx, který uložení provede.

### Workery

- **Procesy workerů**: "Automaticky (jeden na vlákno CPU)" nebo číslo až do počtu vláken CPU, které kontejner vidí. Výchozí: jeden na vlákno, nejvýše 4. Proměnná: `NGINX_WORKER_PROCESSES`.
- **Spojení na workera**: otevřená spojení, která každý worker zpracovává současně, od 64 do 65535. Výchozí: 512. Proměnná: `NGINX_WORKER_CONNECTIONS`.
- **Časový limit ukončení workerů**: jak dlouho si staří workeři po reloadu ponechají svá spojení. Časová hodnota nginx, například `30s`, `10m` nebo `1h`; `0` znamená bez limitu. Výchozí: `1h`. Proměnná: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Logování

- **Logovat chyby nenalezených souborů**: zapíše řádek do logu chyb pro každý požadavek na chybějící soubor. Výchozí: vypnuto. Proměnná: `NGINX_LOG_NOT_FOUND`.

### TLS pro všechny hostitele

Vypnutí TLS 1.2 nebo křivek NIST P vyřadí starší prohlížeče a klienty. TLS 1.3 je vždy zapnuté.

- **Povolit TLS 1.2**: výchozí zapnuto. Proměnná: `NGINX_DISABLE_TLS12` (obrácená: `true` vypne TLS 1.2).
- **Jen postkvantová výměna klíčů**: povolí jen X25519MLKEM768, což vyžaduje nového klienta. Vypne TLS 1.2 a křivky NIST P a zamkne je, dokud je zapnutá. Výchozí: vypnuto. Proměnná: `NGINX_FORCE_X25519MLKEM768`.
- **Povolit křivky NIST P**: secp521r1, secp384r1 a prime256v1 pro výměnu klíčů, vedle X25519. Výchozí: zapnuto. Proměnná: `NGINX_TRUST_SECPR1`.
- **Povolit podpisy RSA PKCS#1**: pro staré klienty, kteří nemohou použít RSA-PSS. Výchozí: vypnuto. Proměnná: `NGINX_TRUST_RSA_PKCS1`.

### Moduly

Všechny jsou ve výchozím stavu vypnuté. Modul zapněte, jen když ho vaše vlastní konfigurace potřebuje. Vypnutí modulu, který vlastní konfigurace stále používá, způsobí selhání testu nginx.

- **njs (JavaScript)**: direktivy `js_*`. Proměnná: `NGINX_LOAD_NJS_MODULE`.
- **Ověřování LDAP**: direktivy `auth_ldap`. Proměnná: `NGINX_LOAD_LDAP_MODULE`.
- **Upstreamy NTLM**: `ntlm` v blocích upstream. Proměnná: `NGINX_LOAD_NTLM_MODULE`.
- **Stav provozu virtuálních hostitelů**: direktivy `vhost_traffic_status_*`. Proměnná: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Více ve wiki: Configuration.
