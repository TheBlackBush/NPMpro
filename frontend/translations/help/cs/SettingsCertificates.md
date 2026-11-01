## Certifikáty a TLS

Výchozí hodnoty pro certifikáty, o které NPMpro žádá váš ACME server (Let's Encrypt, pokud nenastavíte jiný pomocí `ACME_SERVER`), pro to, jak se stapluje a obnovují, a pro certifikát, který odpovídá neznámým hostitelům. Toto je sekce Nastavení, ne stránka se seznamem Certifikátů.

Proměnná nastavená na kontejneru má přednost před rozhraním a zamkne pole (pole ukazuje odznak se zámkem, například "Nastaveno přes ACME_KEY_TYPE"). Některá pole následují jiné: samotné `ACME_KEY_SIZE`, které je křivkou ECDSA, ponechá typ klíče na ECDSA, a Must-Staple ponechá zapnutý OCSP stapling. Rozhraní používejte pro vše, co není nastaveno na kontejneru.

### Žádosti o certifikát

Použijí se od další žádosti o certifikát.

- **Typ klíče**: `ECDSA` (výchozí, doporučeno: menší klíče, rychlejší handshake) nebo `RSA` pro klienty, kteří ECDSA nepodporují. Proměnná: `ACME_KEY_TYPE`.
- **Velikost klíče**: křivka pro ECDSA (`secp256r1`, `secp384r1`, `secp521r1`; výchozí `secp384r1`) nebo počet bitů pro RSA (`2048`, `3072`, `4096`; výchozí `4096`). Proměnná: `ACME_KEY_SIZE`.
- **Profil ACME**: profil požadovaný od serveru, při uložení ověřený se serverem. Prázdný použije výchozí hodnotu serveru. U Let's Encrypt je výchozí `shortlived`; klienti, kteří potřebují Common Name, s certifikáty `shortlived` a `tlsserver` nefungují. Proměnná: `ACME_PROFILE` (`none` pro prázdný).
- **OCSP Must-Staple**: označí nové certifikáty jako must-staple a ponechá zapnutý OCSP stapling. Jen pro certifikační autority, které to podporují (ZeroSSL); Let's Encrypt takové žádosti odmítá. Výchozí: zapnuto pro Google Trust Services a ZeroSSL, jinak vypnuto. Proměnná: `ACME_MUST_STAPLE`.
- **Ověřovat certifikát serveru ACME**: výchozí zapnuto. Vypněte jen pro soukromý ACME server s certifikátem podepsaným sám sebou. Proměnná: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Oba se použijí po reloadu nginx, který uložení provede, a oba vypnou kompresi TLS certifikátů.

- **OCSP stapling pro certifikáty ACME**: posílá odpověď OCSP s certifikáty z ACME serveru, když certifikační autorita nabízí OCSP. Výchozí: zapnuto pro Google Trust Services a ZeroSSL, jinak vypnuto. Proměnná: `ACME_OCSP_STAPLING`.
- **OCSP stapling pro vlastní certifikáty**: totéž pro nahrané certifikáty. Výchozí: vypnuto. Proměnná: `CUSTOM_OCSP_STAPLING`.

### Výchozí certifikát

- **Certifikát pro neznámé hostitele a webové rozhraní**: poskytuje se pro názvy hostitelů, pro které NPMpro nemá hostitele, a na portu webového rozhraní. Výchozí: vestavěný, vygenerovaný zástupný certifikát. Proměnná: `DEFAULT_CERT_ID` (ID certifikátu; `0` je vestavěný). Použije se po reloadu nginx, který uložení provede.

### Obnova

- **Interval kontroly obnovy**: 1 až 499 hodin mezi kontrolami. Certifikát se obnoví, až když na to přijde čas. Výchozí: 3. Proměnná: `CERTBOT_RUN_INTERVAL`. Použije se okamžitě.

### ECH

- **Interval rotace klíčů ECH**: 1 až 24 hodin mezi spuštěními vašeho skriptu ECH (`/data/tls/ech/cron.sh`). Používá se, jen když skript není prázdný. Výchozí: 1. Proměnná: `ECH_ROTATION_INTERVAL`. Použije se okamžitě.

Více ve wiki: Security.
