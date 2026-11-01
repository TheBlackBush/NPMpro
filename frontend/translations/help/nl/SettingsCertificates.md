## Certificaten en TLS

Standaardwaarden voor de certificaten die NPMpro bij uw ACME-server aanvraagt (Let's Encrypt, tenzij u met `ACME_SERVER` een andere instelt), voor hoe ze worden gestapled en verlengd, en voor welk certificaat antwoordt voor onbekende hosts. Dit is de sectie Instellingen, niet de lijstpagina Certificaten.

Een variabele die op de container is gezet, gaat voor op de interface en vergrendelt het veld (het veld toont een slotbadge zoals „Ingesteld door ACME_KEY_TYPE”). Sommige velden volgen een ander: een alleenstaande `ACME_KEY_SIZE` die een ECDSA-curve is, houdt het sleuteltype op ECDSA, en Must-Staple houdt OCSP-stapling aan. Gebruik de interface voor alles wat niet in de container is ingesteld.

### Certificaataanvragen

Deze gelden vanaf de volgende certificaataanvraag.

- **Sleuteltype**: `ECDSA` (standaard, aanbevolen: kleinere sleutels, snellere handshakes) of `RSA` voor clients die ECDSA niet kunnen gebruiken. Variabele: `ACME_KEY_TYPE`.
- **Sleutelgrootte**: de curve voor ECDSA (`secp256r1`, `secp384r1`, `secp521r1`; standaard `secp384r1`) of de bits voor RSA (`2048`, `3072`, `4096`; standaard `4096`). Variabele: `ACME_KEY_SIZE`.
- **ACME-profiel**: het profiel dat bij de server wordt aangevraagd, bij het opslaan met de server gecontroleerd. Leeg gebruikt de standaard van de server. Bij Let's Encrypt is de standaard `shortlived`; clients die een Common Name nodig hebben, werken niet met `shortlived`- en `tlsserver`-certificaten. Variabele: `ACME_PROFILE` (`none` voor leeg).
- **OCSP Must-Staple**: markeert nieuwe certificaten als must-staple en houdt OCSP-stapling aan. Alleen voor CA's die het ondersteunen (ZeroSSL); Let's Encrypt weigert zulke aanvragen. Standaard: aan voor Google Trust Services en ZeroSSL, anders uit. Variabele: `ACME_MUST_STAPLE`.
- **Certificaat van de ACME-server controleren**: standaard aan. Zet het alleen uit voor een privé ACME-server met een zelfondertekend certificaat. Variabele: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Beide gelden na de nginx-herlaadactie die het opslaan uitvoert, en beide zetten TLS-certificaatcompressie uit.

- **OCSP-stapling voor ACME-certificaten**: stuurt het OCSP-antwoord mee met certificaten van de ACME-server, als de CA OCSP biedt. Standaard: aan voor Google Trust Services en ZeroSSL, anders uit. Variabele: `ACME_OCSP_STAPLING`.
- **OCSP-stapling voor aangepaste certificaten**: hetzelfde voor geüploade certificaten. Standaard: uit. Variabele: `CUSTOM_OCSP_STAPLING`.

### Standaardcertificaat

- **Certificaat voor onbekende hosts en de webinterface**: wordt gebruikt voor hostnamen waarvoor NPMpro geen host heeft en op de poort van de webinterface. Standaard: ingebouwd, een gegenereerde plaatsvervanger. Variabele: `DEFAULT_CERT_ID` (een certificaat-ID; `0` is ingebouwd). Geldt na de nginx-herlaadactie die het opslaan uitvoert.

### Verlenging

- **Interval voor verlengingscontrole**: 1 tot 499 uur tussen de controles. Een certificaat wordt alleen verlengd als het aan de beurt is. Standaard: 3. Variabele: `CERTBOT_RUN_INTERVAL`. Geldt direct.

### ECH

- **Rotatie-interval van ECH-sleutels**: 1 tot 24 uur tussen de uitvoeringen van uw ECH-script (`/data/tls/ech/cron.sh`). Wordt alleen gebruikt als het script niet leeg is. Standaard: 1. Variabele: `ECH_ROTATION_INTERVAL`. Geldt direct.

Meer in de wiki: Security.
