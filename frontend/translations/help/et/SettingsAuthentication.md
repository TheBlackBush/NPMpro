## Autentimine

Sisselogimine NPMpro veebiliidesesse OIDC-pakkuja kaudu (näiteks Authentik, Keycloak või Google), paroolide kõrval või asemel. See ei ole edastatud autentimine: see ei kaitse sinu proksihoste. Selle jaoks vaata Seaded, Edastatud autentimine.

Konteineril määratud muutuja on UI-st tähtsam ja lukustab välja (väli näitab "Määratud keskkonnaga"). Kui kõik neli ühendusmuutujat on määratud, on OIDC aktiivne ka ilma UI-s sisse lülitamata. Kõige jaoks, mida konteineris pole määratud, kasuta UI-d. Kõik siin rakendub salvestamisel.

### Pakkuja

- **Luba OIDC-ga sisselogimine**: näitab sisselogimislehel sisselogimisnuppu.
- **Väljastaja URL**: pakkuja discovery baasaadress, näiteks `https://accounts.example.com`. Muutuja: `OIDC_ISSUER_URL`.
- **Kliendi ID** ja **Kliendi saladus**: sinu pakkujalt. Saladus salvestatakse krüptituna ja seda enam ei näidata; jäta tühjaks, et see alles hoida. Kui muudad väljastaja URL-i või kliendi ID-d, sisesta saladus uuesti. Muutujad: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Ümbersuunamise domeen**: domeen, millega inimesed NPMpro avavad, koos pordiga, kui see pole 443. Kohustuslik, sest sellest koostatakse tagasikutse URL. Muutuja: `OIDC_REDIRECT_DOMAIN`.
- **Tagasikutse URL**: ainult lugemiseks. Registreeri see pakkujal ümbersuunamise URI-na.
- **Skoobid**: vaikimisi `openid email profile`. Muuda, kui sinu pakkuja lubab ainult mõnda, näiteks `openid email`.
- **Testi ühendust**: kontrollib, kas NPMpro jõuab väljastajani.

### Sisselogimisnupp

Nupp sisselogimislehel: **Kuvatav nimi** (tekst pärast "Logi sisse:"), **Värv** (eelseadistus või sinu enda `#rrggbb`) ja **Ikoon** (sisseehitatud, üleslaaditud PNG, JPEG, WebP või SVG kuni 256 KB või allalaaditud URL-ilt). Näidatakse eelvaadet.

### Sisselogimisreeglid

- **Nõua kinnitatud e-posti aadressi**: lükkab tagasi kasutajad, kelle e-posti pakkuja pole kinnitanud. Vaikimisi: sees. Muutuja: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Jäta pärast OIDC-d kaheastmeline kinnitamine vahele**: usaldab pakkuja enda mitmefaktorilist kontrolli. Vaikimisi: väljas. Muutuja: `OIDC_SKIP_MFA`.
- **Keela paroolisisselogimine**: sisse saab logida ainult OIDC-ga. Saad selle sisse lülitada ainult OIDC-ga sisse loginud sessioonist. Muutuja: `OIDC_DISABLE_PASSWORD`; parooliga sisselogimise taastamiseks sea see väärtusele `false` ja loo konteiner uuesti.

### Uued kasutajad

- **Loo kasutajad nende esimesel sisselogimisel** (vaikimisi väljas): konto puudumisel inimene saab selle allolevate õigustega.
- **Lubatud e-posti domeenid**: komadega eraldatud; tühi lubab mis tahes domeeni. Tühja loendi ja kinnitatud e-posti mittenõudmise korral saab konto igaüks, kelle sinu pakkuja vastu võtab.
- **Uute kasutajate vaikeõigused**: seatakse jaotiste kaupa. Uued kasutajad ei ole kunagi administraatorid.

Rohkem wikis: Authentication.
