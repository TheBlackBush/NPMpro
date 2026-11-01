## Certifikáty a TLS

Predvolené hodnoty pre certifikáty, ktoré NPMpro žiada od vášho servera ACME (Let's Encrypt, pokiaľ cez `ACME_SERVER` nenastavíte iný), ako sa stapľujú a obnovujú a ktorý certifikát odpovedá neznámym hostiteľom. Toto je sekcia Nastavení, nie stránka so zoznamom certifikátov.

Premenná nastavená na kontajneri má prednosť pred používateľským rozhraním a zamkne pole (pole zobrazí odznak zámku, napríklad "Nastavené cez ACME_KEY_TYPE"). Niektoré polia nasledujú iné: samotná `ACME_KEY_SIZE`, ktorá je krivkou ECDSA, ponechá typ kľúča na ECDSA a Must-Staple ponechá OCSP stapling zapnutý. Pre všetko, čo nie je nastavené v kontajneri, použite rozhranie.

### Žiadosti o certifikát

Tieto sa použijú od najbližšej žiadosti o certifikát.

- **Typ kľúča**: `ECDSA` (predvolené, odporúčané: menšie kľúče, rýchlejšie handshaky) alebo `RSA` pre klientov, ktorí ECDSA nepodporujú. Premenná: `ACME_KEY_TYPE`.
- **Veľkosť kľúča**: krivka pre ECDSA (`secp256r1`, `secp384r1`, `secp521r1`; predvolene `secp384r1`) alebo počet bitov pre RSA (`2048`, `3072`, `4096`; predvolene `4096`). Premenná: `ACME_KEY_SIZE`.
- **Profil ACME**: profil požadovaný od servera, pri uložení sa overí so serverom. Prázdne použije predvolený profil servera. S Let's Encrypt je predvolený `shortlived`; klienti, ktorí potrebujú Common Name, nefungujú s certifikátmi `shortlived` a `tlsserver`. Premenná: `ACME_PROFILE` (`none` pre prázdny).
- **OCSP Must-Staple**: označí nové certifikáty ako must-staple a ponechá OCSP stapling zapnutý. Len pre CA, ktoré to podporujú (ZeroSSL); Let's Encrypt takéto žiadosti odmieta. Predvolené: zapnuté pre Google Trust Services a ZeroSSL, inak vypnuté. Premenná: `ACME_MUST_STAPLE`.
- **Overovať certifikát servera ACME**: predvolene zapnuté. Vypnite len pre súkromný server ACME so self-signed certifikátom. Premenná: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Obe sa použijú po reloade nginx, ktorý uloženie spustí, a obe vypnú kompresiu TLS certifikátov.

- **OCSP stapling pre certifikáty ACME**: posiela odpoveď OCSP s certifikátmi zo servera ACME, ak CA ponúka OCSP. Predvolené: zapnuté pre Google Trust Services a ZeroSSL, inak vypnuté. Premenná: `ACME_OCSP_STAPLING`.
- **OCSP stapling pre vlastné certifikáty**: to isté pre nahrané certifikáty. Predvolené: vypnuté. Premenná: `CUSTOM_OCSP_STAPLING`.

### Predvolený certifikát

- **Certifikát pre neznámych hostiteľov a webové rozhranie**: poskytuje sa pre názvy hostiteľov, pre ktoré NPMpro nemá hostiteľa, a na porte webového rozhrania. Predvolené: vstavaný, vygenerovaný zástupný certifikát. Premenná: `DEFAULT_CERT_ID` (ID certifikátu; `0` je vstavaný). Použije sa po reloade nginx, ktorý uloženie spustí.

### Obnova

- **Interval kontroly obnovy**: 1 až 499 hodín medzi kontrolami. Certifikát sa obnoví, až keď treba. Predvolené: 3. Premenná: `CERTBOT_RUN_INTERVAL`. Použije sa okamžite.

### ECH

- **Interval rotácie kľúčov ECH**: 1 až 24 hodín medzi behmi vášho skriptu ECH (`/data/tls/ech/cron.sh`). Používa sa, len keď skript nie je prázdny. Predvolené: 1. Premenná: `ECH_ROTATION_INTERVAL`. Použije sa okamžite.

Viac vo wiki: Security.
