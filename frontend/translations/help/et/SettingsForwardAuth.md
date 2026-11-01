## Edastatud autentimine

Edastatud autentimine paneb proksihosti ette sisselogimise või robotikontrolli. Iga päringu puhul küsib nginx esmalt autentimisteenuselt, kas külastaja võib läbi minna. NPMprol on see sisseehitatud Anubise, Tinyauthi, OAuth2 Proxy, VoidAuthi, Authelia ja Authentiku jaoks. Pakkujat käitad oma konteineris.

See leht seab iga pakkuja vaikeaadressi (upstream). Proksihost lülitab kontrolli sisse valikuga **Auth Request** jaotises Valikud Üksikasjad-vahekaardil (või kohandatud asukohal).

Konteineril määratud muutuja on UI-st tähtsam ja lukustab välja (väli näitab lukumärki, näiteks "Määratud muutujaga AUTH_REQUEST_AUTHELIA_UPSTREAM"). Kõige jaoks, mida konteineris pole määratud, kasuta UI-d. Iga siinne seade rakendub pärast nginxi taaslaadimist, mille salvestamine käivitab. Kui nginxi test ebaõnnestub, ei salvestata midagi.

### Vaikesihtserverid

- **Anubis upstream**, **Tinyauth upstream**, **OAuth2 Proxy upstream**, **VoidAuth upstream**, **Authelia upstream**, **Authentik upstream**: kasutavad proksihostid selle pakkujaga, millel pole oma sihtserverit. Hosti enda väärtus võidab. Vaikimisi: tühi (puudub). Muutujad: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Vorming: `scheme://host:port`, näiteks `http://127.0.0.1:9091`, või `scheme://cu_name` sinu enda nginxi upstream-ploki jaoks, mille nimi algab `cu_`. Kasuta `http` või `https`; port on kohustuslik; IPv6 aadress käib nurksulgudesse. Ilma teeta, ilma tühikuteta ja ilma ühegi märgita `; { } # " ' $ \`.

Vaikeväärtust ei saa tühjendada, kuni proksihostid kasutavad seda pakkujat ilma oma sihtserverita. Teade loetleb need hostid.

Host, mis kasutab pakkujat, millel pole sihtserverit kusagil, saab "Konfiguratsiooniviga".

### Anubis

- **Kohandatud Anubise pildid**: näitab Anubise väljakutselehtedel sinu enda faile `happy.webp`, `reject.webp` ja `pensive.webp`. Vaikimisi: sees, kui kõik kolm faili on olemas ja pole tühjad, muidu väljas. Muutuja: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. Pildid lähevad sinu andmekausta kausta `public/anubis`.

Rohkem wikis: Forward-Authentication.
