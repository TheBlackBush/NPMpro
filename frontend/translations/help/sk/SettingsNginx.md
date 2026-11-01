## nginx

Nastavenia samotného nginx, ktoré platia pre všetkých hostiteľov: koľko workerov beží, pravidlá TLS a voliteľné moduly. Uloženie otestuje konfiguráciu a znova načíta nginx. Konfigurácia, ktorá test neprejde, sa nepoužije.

Premenná nastavená na kontajneri má prednosť pred používateľským rozhraním a zamkne pole (pole zobrazí odznak zámku, napríklad "Nastavené cez NGINX_WORKER_PROCESSES"). Pre všetko, čo nie je nastavené v kontajneri, použite rozhranie. Každé nastavenie sa tu použije po reloade nginx, ktorý uloženie spustí.

### Workery

- **Procesy workerov**: "Automaticky (jeden na vlákno CPU)" alebo číslo do počtu vlákien CPU, ktoré kontajner vidí. Predvolené: jeden na vlákno, najviac 4. Premenná: `NGINX_WORKER_PROCESSES`.
- **Spojenia na workera**: otvorené spojenia, ktoré každý worker obsluhuje naraz, 64 až 65535. Predvolené: 512. Premenná: `NGINX_WORKER_CONNECTIONS`.
- **Časový limit ukončenia workerov**: ako dlho si starí workeri po reloade ponechajú spojenia. Časová hodnota nginx, napríklad `30s`, `10m` alebo `1h`; `0` znamená bez limitu. Predvolené: `1h`. Premenná: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Logovanie

- **Logovať chyby nenájdených súborov**: zapíše riadok do error logu pre každú požiadavku na chýbajúci súbor. Predvolené: vypnuté. Premenná: `NGINX_LOG_NOT_FOUND`.

### TLS pre všetkých hostiteľov

Vypnutie TLS 1.2 alebo kriviek NIST P vylúči staršie prehliadače a klientov. TLS 1.3 je vždy zapnuté.

- **Povoliť TLS 1.2**: predvolene zapnuté. Premenná: `NGINX_DISABLE_TLS12` (opačne: `true` vypne TLS 1.2).
- **Len postkvantová výmena kľúčov**: povolí iba X25519MLKEM768, čo vyžaduje novšieho klienta. Vypne TLS 1.2 a krivky NIST P a kým je zapnuté, zamkne ich. Predvolené: vypnuté. Premenná: `NGINX_FORCE_X25519MLKEM768`.
- **Povoliť krivky NIST P**: secp521r1, secp384r1 a prime256v1 pre výmenu kľúčov, popri X25519. Predvolené: zapnuté. Premenná: `NGINX_TRUST_SECPR1`.
- **Povoliť podpisy RSA PKCS#1**: pre starých klientov, ktorí nevedia použiť RSA-PSS. Predvolené: vypnuté. Premenná: `NGINX_TRUST_RSA_PKCS1`.

### Moduly

Všetky sú predvolene vypnuté. Modul zapnite, len keď ho potrebuje vaša vlastná konfigurácia. Vypnutie modulu, ktorý vlastná konfigurácia ešte používa, spôsobí zlyhanie testu nginx.

- **njs (JavaScript)**: direktívy `js_*`. Premenná: `NGINX_LOAD_NJS_MODULE`.
- **Overovanie LDAP**: direktívy `auth_ldap`. Premenná: `NGINX_LOAD_LDAP_MODULE`.
- **Upstreamy NTLM**: `ntlm` v blokoch upstream. Premenná: `NGINX_LOAD_NTLM_MODULE`.
- **Stav prevádzky virtuálnych hostiteľov**: direktívy `vhost_traffic_status_*`. Premenná: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Viac vo wiki: Configuration.
