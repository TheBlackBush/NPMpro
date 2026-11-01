## nginx

Magának az nginxnek a beállításai, amelyek minden kiszolgálóra érvényesek: hány worker fut, a TLS-szabályok és az opcionális modulok. A mentés teszteli a konfigurációt, és újratölti az nginxet. A tesztet nem teljesítő konfiguráció nem kerül alkalmazásra.

A konténeren beállított változó felülírja a felületet, és zárolja a mezőt (a mező zár jelvényt mutat, például "Beállítja: NGINX_WORKER_PROCESSES"). Amit nem a konténerben állított be, azt a felületen adja meg. Itt minden beállítás a mentéskor futó nginx-újratöltés után lép életbe.

### Workerek

- **Worker folyamatok**: "Automatikus (CPU-szálanként egy)" vagy egy szám a konténer által látott CPU-szálak számáig. Alapértelmezett: szálanként egy, legfeljebb 4. Változó: `NGINX_WORKER_PROCESSES`.
- **Kapcsolatok workerenként**: a nyitott kapcsolatok, amelyeket mindegyik worker egyszerre kezel, 64-65535. Alapértelmezett: 512. Változó: `NGINX_WORKER_CONNECTIONS`.
- **Worker leállítási időkorlát**: meddig tartják meg a régi workerek a kapcsolataikat újratöltés után. Nginx időérték, például `30s`, `10m` vagy `1h`; a `0` korlát nélkülit jelent. Alapértelmezett: `1h`. Változó: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Naplózás

- **Fájl nem található hibák naplózása**: hibanapló-sort ír minden hiányzó fájlra irányuló kérésnél. Alapértelmezett: ki. Változó: `NGINX_LOG_NOT_FOUND`.

### TLS minden kiszolgálóhoz

A TLS 1.2 vagy a NIST P görbék kikapcsolása kizárja a régebbi böngészőket és klienseket. A TLS 1.3 mindig be van kapcsolva.

- **TLS 1.2 engedélyezése**: alapból be. Változó: `NGINX_DISABLE_TLS12` (fordított: a `true` kikapcsolja a TLS 1.2-t).
- **Csak posztkvantum kulcscsere**: csak az X25519MLKEM768-at engedi, amihez friss kliens kell. Kikapcsolja a TLS 1.2-t és a NIST P görbéket, és bekapcsolt állapotában zárolja őket. Alapértelmezett: ki. Változó: `NGINX_FORCE_X25519MLKEM768`.
- **NIST P görbék engedélyezése**: secp521r1, secp384r1 és prime256v1 a kulcscseréhez, az X25519 mellett. Alapértelmezett: be. Változó: `NGINX_TRUST_SECPR1`.
- **RSA PKCS#1 aláírások engedélyezése**: régi kliensekhez, amelyek nem tudják használni az RSA-PSS-t. Alapértelmezett: ki. Változó: `NGINX_TRUST_RSA_PKCS1`.

### Modulok

Mind alapból ki van kapcsolva. Modult csak akkor kapcsoljon be, ha egy saját konfigurációjának szüksége van rá. Ha kikapcsol egy modult, miközben egy saját konfiguráció még használja, az nginx-teszt sikertelen lesz.

- **njs (JavaScript)**: `js_*` direktívák. Változó: `NGINX_LOAD_NJS_MODULE`.
- **LDAP hitelesítés**: `auth_ldap` direktívák. Változó: `NGINX_LOAD_LDAP_MODULE`.
- **NTLM upstreamek**: `ntlm` az upstream blokkokban. Változó: `NGINX_LOAD_NTLM_MODULE`.
- **Virtuális hosztok forgalmi állapota**: `vhost_traffic_status_*` direktívák. Változó: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Továbbiak a wikiben: Configuration.
