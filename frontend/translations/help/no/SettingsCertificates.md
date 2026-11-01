## Sertifikater og TLS

Standardverdier for sertifikatene NPMpro ber om fra ACME-serveren din (Let's Encrypt med mindre du setter en annen med `ACME_SERVER`), hvordan de stiftes og fornyes, og hvilket sertifikat som svarer for ukjente verter. Dette er Innstillinger-seksjonen, ikke Sertifikater-listesiden.

En variabel satt på containeren vinner over brukergrensesnittet og låser feltet (feltet viser et låsemerke som «Satt av ACME_KEY_TYPE»). Noen felt følger et annet: en enkeltstående `ACME_KEY_SIZE` som er en ECDSA-kurve holder nøkkeltypen på ECDSA, og Must-Staple holder OCSP-stifting på. Bruk brukergrensesnittet for alt som ikke er satt i containeren.

### Sertifikatforespørsler

Disse gjelder fra neste sertifikatforespørsel.

- **Nøkkeltype**: `ECDSA` (standard, anbefalt: mindre nøkler, raskere håndtrykk) eller `RSA` for klienter som ikke kan bruke ECDSA. Variabel: `ACME_KEY_TYPE`.
- **Nøkkelstørrelse**: kurven for ECDSA (`secp256r1`, `secp384r1`, `secp521r1`, standard `secp384r1`) eller bitene for RSA (`2048`, `3072`, `4096`, standard `4096`). Variabel: `ACME_KEY_SIZE`.
- **ACME-profil**: profilen det bes om fra serveren, kontrollert mot serveren når du lagrer. Tom bruker serverens standard. Med Let's Encrypt er standarden `shortlived`. Klienter som trenger et Common Name fungerer ikke med `shortlived`- og `tlsserver`-sertifikater. Variabel: `ACME_PROFILE` (`none` for tom).
- **OCSP Must-Staple**: merker nye sertifikater som must-staple og holder OCSP-stifting på. Bare for CA-er som støtter det (ZeroSSL). Let's Encrypt avviser slike forespørsler. Standard: på for Google Trust Services og ZeroSSL, ellers av. Variabel: `ACME_MUST_STAPLE`.
- **Verifiser sertifikatet til ACME-serveren**: standard på. Slå den av bare for en privat ACME-server med et selvsignert sertifikat. Variabel: `ACME_SERVER_TLS_VERIFY`.

### Stifting

Begge tas i bruk etter nginx-omlastingen som lagringen kjører, og begge slår av komprimering av TLS-sertifikater.

- **OCSP-stifting for ACME-sertifikater**: sender OCSP-svaret sammen med sertifikater fra ACME-serveren, når CA-en tilbyr OCSP. Standard: på for Google Trust Services og ZeroSSL, ellers av. Variabel: `ACME_OCSP_STAPLING`.
- **OCSP-stifting for egendefinerte sertifikater**: det samme for opplastede sertifikater. Standard: av. Variabel: `CUSTOM_OCSP_STAPLING`.

### Standardsertifikat

- **Sertifikat for ukjente verter og webgrensesnittet**: brukes for vertsnavn NPMpro ikke har noen vert for, og på porten til webgrensesnittet. Standard: innebygd, et generert plassholdersertifikat. Variabel: `DEFAULT_CERT_ID` (en sertifikat-ID, `0` er innebygd). Tas i bruk etter nginx-omlastingen som lagringen kjører.

### Fornyelse

- **Intervall for fornyelseskontroll**: 1 til 499 timer mellom kontrollene. Et sertifikat fornyes bare når det er på tide. Standard: 3. Variabel: `CERTBOT_RUN_INTERVAL`. Tas i bruk med en gang.

### ECH

- **Rotasjonsintervall for ECH-nøkler**: 1 til 24 timer mellom kjøringene av ECH-skriptet ditt (`/data/tls/ech/cron.sh`). Brukes bare når skriptet ikke er tomt. Standard: 1. Variabel: `ECH_ROTATION_INTERVAL`. Tas i bruk med en gang.

Mer i wikien: Security.
