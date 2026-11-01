## nginx

Nginxi enda seaded, mis kehtivad kõigile hostidele: mitu workerit töötab, TLS-i reeglid ja valikulised moodulid. Salvestamine testib konfiguratsiooni ja laadib nginxi uuesti. Testi mitteläbiv konfiguratsioon ei rakendu.

Konteineril määratud muutuja on UI-st tähtsam ja lukustab välja (väli näitab lukumärki, näiteks "Määratud muutujaga NGINX_WORKER_PROCESSES"). Kõige jaoks, mida konteineris pole määratud, kasuta UI-d. Iga siinne seade rakendub pärast nginxi taaslaadimist, mille salvestamine käivitab.

### Workerid

- **Workeri protsessid**: "Automaatne (üks CPU lõime kohta)" või arv kuni CPU lõimede arvuni, mida konteiner näeb. Vaikimisi: üks lõime kohta, kuni 4. Muutuja: `NGINX_WORKER_PROCESSES`.
- **Ühendusi workeri kohta**: avatud ühendused, mida iga worker korraga käsitleb, 64 kuni 65535. Vaikimisi: 512. Muutuja: `NGINX_WORKER_CONNECTIONS`.
- **Workeri sulgemise ajalõpp**: kui kaua vanad workerid taaslaadimise järel oma ühendusi hoiavad. Nginxi ajaväärtus nagu `30s`, `10m` või `1h`; `0` tähendab piirangut pole. Vaikimisi: `1h`. Muutuja: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Logimine

- **Logi faili ei leitud vead**: kirjutab vealogisse rea iga puuduva faili päringu kohta. Vaikimisi: väljas. Muutuja: `NGINX_LOG_NOT_FOUND`.

### TLS kõigile hostidele

TLS 1.2 või NIST P kõverate väljalülitamine jätab välja vanemad brauserid ja kliendid. TLS 1.3 on alati sees.

- **Luba TLS 1.2**: vaikimisi sees. Muutuja: `NGINX_DISABLE_TLS12` (pööratud: `true` lülitab TLS 1.2 välja).
- **Ainult kvantkindel võtmevahetus**: lubab ainult X25519MLKEM768, mis vajab uut klienti. See lülitab TLS 1.2 ja NIST P kõverad välja ning lukustab need, kuni see on sees. Vaikimisi: väljas. Muutuja: `NGINX_FORCE_X25519MLKEM768`.
- **Luba NIST P kõverad**: secp521r1, secp384r1 ja prime256v1 võtmevahetuseks, X25519 kõrval. Vaikimisi: sees. Muutuja: `NGINX_TRUST_SECPR1`.
- **Luba RSA PKCS#1 allkirjad**: vanadele klientidele, kes ei saa kasutada RSA-PSS-i. Vaikimisi: väljas. Muutuja: `NGINX_TRUST_RSA_PKCS1`.

### Moodulid

Kõik on vaikimisi väljas. Lülita moodul sisse ainult siis, kui sinu kohandatud konfiguratsioon seda vajab. Mooduli väljalülitamine, kui kohandatud konfiguratsioon seda veel kasutab, ebaõnnestub nginxi testis.

- **njs (JavaScript)**: `js_*` direktiivid. Muutuja: `NGINX_LOAD_NJS_MODULE`.
- **LDAP-autentimine**: `auth_ldap` direktiivid. Muutuja: `NGINX_LOAD_LDAP_MODULE`.
- **NTLM-sihtserverid**: `ntlm` upstream-plokkides. Muutuja: `NGINX_LOAD_NTLM_MODULE`.
- **Virtuaalhostide liikluse olek**: `vhost_traffic_status_*` direktiivid. Muutuja: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Rohkem wikis: Configuration.
