## Sertifikaadid ja TLS

Vaikeväärtused sertifikaatidele, mida NPMpro küsib sinu ACME-serverilt (Let's Encrypt, kui sa muutujaga `ACME_SERVER` muud ei sea), sellele, kuidas neid stapleeritakse ja uuendatakse, ning sellele, milline sertifikaat vastab tundmatutele hostidele. See on Seadete jaotis, mitte Sertifikaatide loendileht.

Konteineril määratud muutuja on UI-st tähtsam ja lukustab välja (väli näitab lukumärki, näiteks "Määratud muutujaga ACME_KEY_TYPE"). Mõned väljad järgivad teist: üksik `ACME_KEY_SIZE`, mis on ECDSA kõver, hoiab võtme tüübi ECDSA peal ja Must-Staple hoiab OCSP staplingu sees. Kõige jaoks, mida konteineris pole määratud, kasuta UI-d.

### Sertifikaaditaotlused

Need rakenduvad järgmisest sertifikaaditaotlusest.

- **Võtme tüüp**: `ECDSA` (vaikimisi, soovitatav: väiksemad võtmed, kiiremad kätlused) või `RSA` klientidele, kes ECDSA-d kasutada ei saa. Muutuja: `ACME_KEY_TYPE`.
- **Võtme suurus**: ECDSA kõver (`secp256r1`, `secp384r1`, `secp521r1`; vaikimisi `secp384r1`) või RSA bitid (`2048`, `3072`, `4096`; vaikimisi `4096`). Muutuja: `ACME_KEY_SIZE`.
- **ACME-profiil**: serverilt küsitav profiil, mida salvestamisel serveriga kontrollitakse. Tühi kasutab serveri vaikeprofiili. Let's Encryptiga on vaikimisi `shortlived`; kliendid, kes vajavad Common Name'i, ei tööta `shortlived` ja `tlsserver` sertifikaatidega. Muutuja: `ACME_PROFILE` (`none` tühja jaoks).
- **OCSP Must-Staple**: märgib uued sertifikaadid must-staple'iks ja hoiab OCSP staplingu sees. Ainult CA-dele, mis seda toetavad (ZeroSSL); Let's Encrypt lükkab sellised taotlused tagasi. Vaikimisi: sees Google Trust Servicesi ja ZeroSSL-i jaoks, muidu väljas. Muutuja: `ACME_MUST_STAPLE`.
- **Kontrolli ACME-serveri sertifikaati**: vaikimisi sees. Lülita välja ainult isikliku ACME-serveri jaoks, millel on isesigneeritud sertifikaat. Muutuja: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Mõlemad rakenduvad pärast nginxi taaslaadimist, mille salvestamine käivitab, ja mõlemad lülitavad TLS-sertifikaatide tihendamise välja.

- **OCSP stapling ACME-sertifikaatidele**: saadab OCSP vastuse koos ACME-serveri sertifikaatidega, kui CA pakub OCSP-d. Vaikimisi: sees Google Trust Servicesi ja ZeroSSL-i jaoks, muidu väljas. Muutuja: `ACME_OCSP_STAPLING`.
- **OCSP stapling kohandatud sertifikaatidele**: sama üleslaaditud sertifikaatidele. Vaikimisi: väljas. Muutuja: `CUSTOM_OCSP_STAPLING`.

### Vaikesertifikaat

- **Sertifikaat tundmatutele hostidele ja veebiliidesele**: serveeritakse hostinimedele, mille jaoks NPMprol hosti pole, ja veebiliidese pordil. Vaikimisi: sisseehitatud, genereeritud kohatäide. Muutuja: `DEFAULT_CERT_ID` (sertifikaadi ID; `0` on sisseehitatud). Rakendub pärast nginxi taaslaadimist, mille salvestamine käivitab.

### Uuendamine

- **Uuendamise kontrolli intervall**: 1 kuni 499 tundi kontrollide vahel. Sertifikaat uuendatakse ainult siis, kui on aeg. Vaikimisi: 3. Muutuja: `CERTBOT_RUN_INTERVAL`. Rakendub kohe.

### ECH

- **ECH-võtme vahetamise intervall**: 1 kuni 24 tundi sinu ECH-skripti (`/data/tls/ech/cron.sh`) käivituste vahel. Kasutatakse ainult siis, kui skript pole tühi. Vaikimisi: 1. Muutuja: `ECH_ROTATION_INTERVAL`. Rakendub kohe.

Rohkem wikis: Security.
