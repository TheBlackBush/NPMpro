## Tanúsítványok és TLS

Alapértékek az NPMpro által az ACME-kiszolgálótól kért tanúsítványokhoz (Let's Encrypt, hacsak az `ACME_SERVER` változóval mást nem állít be), ahhoz, hogyan kapnak staplinget és hogyan újulnak meg, és hogy melyik tanúsítvány válaszol az ismeretlen hosztoknak. Ez a Beállítások szakasz, nem a Tanúsítványok listaoldal.

A konténeren beállított változó felülírja a felületet, és zárolja a mezőt (a mező zár jelvényt mutat, például "Beállítja: ACME_KEY_TYPE"). Egyes mezők egy másikat követnek: az önmagában álló, ECDSA-görbét jelölő `ACME_KEY_SIZE` ECDSA-n tartja a kulcstípust, a Must-Staple pedig bekapcsolva tartja az OCSP staplinget. Amit nem a konténerben állított be, azt a felületen adja meg.

### Tanúsítványkérések

Ezek a következő tanúsítványkéréstől érvényesek.

- **Kulcstípus**: `ECDSA` (alapértelmezett, ajánlott: kisebb kulcsok, gyorsabb kézfogások) vagy `RSA` az ECDSA-t nem használni tudó kliensekhez. Változó: `ACME_KEY_TYPE`.
- **Kulcsméret**: ECDSA-nál a görbe (`secp256r1`, `secp384r1`, `secp521r1`; alapértelmezett `secp384r1`), RSA-nál a bitek száma (`2048`, `3072`, `4096`; alapértelmezett `4096`). Változó: `ACME_KEY_SIZE`.
- **ACME profil**: a szervertől kért profil, mentéskor egyeztetve a szerverrel. Üresen a szerver alapértelmezett profilja érvényes. Let's Encrypt esetén az alapértelmezett `shortlived`; a Common Name-et igénylő kliensek nem működnek a `shortlived` és `tlsserver` tanúsítványokkal. Változó: `ACME_PROFILE` (`none` az üreshez).
- **OCSP Must-Staple**: az új tanúsítványokat must-staple-ként jelöli, és bekapcsolva tartja az OCSP staplinget. Csak az ezt támogató hitelesítésszolgáltatóknál (ZeroSSL); a Let's Encrypt elutasítja az ilyen kérést. Alapértelmezett: be a Google Trust Services és a ZeroSSL esetén, egyébként ki. Változó: `ACME_MUST_STAPLE`.
- **Az ACME szerver tanúsítványának ellenőrzése**: alapból be. Csak saját, önaláírt tanúsítványú privát ACME-szerverhez kapcsolja ki. Változó: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Mindkettő a mentéskor futó nginx-újratöltés után lép életbe, és mindkettő kikapcsolja a TLS tanúsítványtömörítést.

- **OCSP stapling ACME tanúsítványokhoz**: elküldi az OCSP-választ az ACME-kiszolgálótól származó tanúsítványokkal, ha a hitelesítésszolgáltató kínál OCSP-t. Alapértelmezett: be a Google Trust Services és a ZeroSSL esetén, egyébként ki. Változó: `ACME_OCSP_STAPLING`.
- **OCSP stapling egyéni tanúsítványokhoz**: ugyanez a feltöltött tanúsítványokra. Alapértelmezett: ki. Változó: `CUSTOM_OCSP_STAPLING`.

### Alapértelmezett tanúsítvány

- **Tanúsítvány ismeretlen kiszolgálókhoz és a webes felülethez**: azokhoz a hosztnevekhez használatos, amelyekhez az NPMpro-nak nincs kiszolgálója, valamint a webes felület portján. Alapértelmezett: beépített, egy generált helyőrző. Változó: `DEFAULT_CERT_ID` (tanúsítványazonosító; a `0` a beépített). A mentéskor futó nginx-újratöltés után lép életbe.

### Megújítás

- **Megújítás-ellenőrzési időköz**: 1-499 óra az ellenőrzések között. A tanúsítvány csak esedékességkor újul meg. Alapértelmezett: 3. Változó: `CERTBOT_RUN_INTERVAL`. Azonnal érvényesül.

### ECH

- **ECH kulcsforgatási időköz**: 1-24 óra az ECH szkript (`/data/tls/ech/cron.sh`) futásai között. Csak akkor használatos, ha a szkript nem üres. Alapértelmezett: 1. Változó: `ECH_ROTATION_INTERVAL`. Azonnal érvényesül.

Továbbiak a wikiben: Security.
