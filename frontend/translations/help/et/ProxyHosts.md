## Mis on proksihost?

Proksihost on veebiteenuse esiuks. Külastajad avavad sinu domeeni NPMpros ja NPMpro suunab päringu edasi selle taga olevale teenusele. See võib lisada ka TLS-i (HTTPS) teenustele, millel seda pole. Proksihostid on NPMpro kõige tavalisem kasutus.

Kasuta hosti menüüs valikut **Klooni**, et kopeerida host uude Lisa-aknasse. Koopia algab ilma domeeninimedeta, sest domeen võib kuuluda ainult ühele lubatud hostile.

### Üksikasjad

- **Domeeninimed**: nimed, mida külastajad kasutavad. Kohustuslik. Uue sertifikaadi puhul vajavad metamärgiga nimed (`*.example.com`) DNS-väljakutset.
- **Skeem**: kuidas NPMpro teenusega suhtleb: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (failide või PHP serveerimine kaustast) või `empty` (sihtserverit pole). Vaikimisi `http://`. Skeemi muutmine lülitab välja sellele sobimatud valikud.
- **Edastamise hostinimi / IP / tee**: teenuse aadress. Võid lisada alamtee, näiteks `127.0.0.1/path`. Valiku `path` korral sisesta selle asemel kaust. Ühenda oma failid kausta `/var/www` alla; väljaspool seda olevat kausta saavad kasutada ainult administraatorid. Nimi, mis algab `cu_`, osutab sinu enda nginxi upstream-plokile (vaata wikist Load balancing).
- **Edastusport**: valikuline. Valiku `path` korral on see PHP versioon.
- **Rühm**: vaba silt, mis hoiab pikad loendid korras.
- **Valikud** (kõik vaikimisi väljas):
  - **Saada noindex-päis ja blokeeri mõned robotite user agentid**: palub otsingumootoritel saiti mitte indekseerida ja blokeerib mõned roomajad.
  - **Keela CrowdSec AppSec**: lülitab CrowdSec AppSeci välja ainult selle hosti jaoks. Mõjub ainult siis, kui AppSec on seadistatud.
  - **Keela päringu puhverdamine** ja **Keela vastuse puhverdamine**: http ja https sihtserveritele. Hoia puhverdamine sees, välja arvatud juhul, kui voogedastad või laed kiirel ja stabiilsel ühendusel üles suuri faile. Päringu puhverdamise väljalülitamine lülitab välja ka AppSeci.
  - **Luba tihendamine sihtserveri poolt**: lubab teenusel oma vastuseid ise tihendada. Hoia väljas, kui teenus seda just ei vaja. Mitte valikute `path` ja `empty` jaoks.
  - **Luba fancyindex**: näitab faililoendit, kui kaustas pole indeksfaili. Ainult valiku `path` jaoks.
- **X-Frame-Options**: `SAMEORIGIN` (vaikimisi), `DENY`, `none` (eemaldab päise) või `upstream` (jätab alles selle, mida teenus saadab).
- **Auth Request**: paneb hosti ette sisselogimise või robotikontrolli (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Vaikimisi `none`. **Auth Requesti sihtserver** on valikuline; tühjana kasutatakse vaikeväärtust jaotisest Seaded, Edastatud autentimine.
- **Globaalsed juurdepääsuloendid**: **Avalikult ligipääsetav** (vaikimisi, sisselogimist pole) või **Kohandatud**, üks või mitu juurdepääsuloendit.

Websocketid on alati sees.

### Kohandatud asukohad

Asukoht suunab hosti ühe tee (näiteks `/api/`) teisele teenusele. Igaühel on **Sees**, tee valikulise vastavustüübiga (`=`, `~`, `~*`, `^~` või `@`), oma skeem, host, port, valikud, Auth Request ja juurdepääsuloendid. Selle juurdepääsuloend võib olla **Globaalne**, mis kasutab hosti loendeid. See ei päri hosti Auth Requesti. Lisa teele lõpus kaldkriips, kui sa ei taha eesliitega vastavust. Administraatorid saavad hammasrattanupust lisada asukohakohase kohandatud nginxi konfiguratsiooni.

### TLS

- **TLS-sertifikaat**: Puudub, Taotle uut sertifikaati või olemasolev. Allpool olevad valikud vajavad sertifikaati.
- **mTLS-sertifikaat**: kliendisertifikaatide sertifitseerimiskeskus. **Muuda mTLS valikuliseks** laseb sisse ka sertifikaadita külastajad. **mTLS jätab Auth Requesti vahele** laseb kehtiva sertifikaadiga külastajatel Auth Requesti vahele jätta.
- **Sunni HTTPS** suunab HTTP HTTPS-ile ümber. **HTTP/3 tugi** lubab HTTP/3 (QUIC).
- **HSTS sees (2 aastat)**: vajab valikut Sunni HTTPS. **HSTS alamdomeenid+Preload** vajab HSTS-i.
- Uue sertifikaadi jaoks: **Kasuta võtit uuesti (pole soovitatav)** ja **Kasuta DNS-väljakutset**, koos pakkuja, volituste ja levimise sekunditega.

### Täpsemad

Kohandatud nginxi konfiguratsioon kogu hostile (server-plokk) ja põhiasukohale `location /`. Seda saavad muuta ainult administraatorid.

Rohkem wikis: Host options.
