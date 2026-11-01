## Čo je proxy hostiteľ?

Proxy hostiteľ je vstupná brána webovej služby. Návštevníci otvoria vašu doménu v NPMpro a NPMpro presmeruje požiadavku na službu za ním. Môže tiež pridať TLS (HTTPS) pre služby, ktoré ho nemajú. Proxy hostitelia sú najčastejším použitím NPMpro.

Pomocou **Klonovať** v ponuke hostiteľa skopírujete hostiteľa do nového okna Pridať. Kópia začína bez doménových mien, pretože doména môže patriť len jednému zapnutému hostiteľovi.

### Podrobnosti

- **Doménové mená**: mená, ktoré používajú návštevníci. Povinné. Pri novom certifikáte vyžadujú zástupné znaky (`*.example.com`) DNS výzvu.
- **Schéma**: ako NPMpro komunikuje so službou: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (poskytovanie súborov alebo PHP z priečinka) alebo `empty` (bez upstreamu). Predvolene `http://`. Zmena schémy vypne možnosti, ktoré sa k nej nehodia.
- **Cieľový názov hostiteľa / IP / cesta**: adresa služby. Môžete pridať podcestu, napríklad `127.0.0.1/path`. Pri `path` zadajte namiesto toho priečinok. Súbory pripojte pod `/var/www`; priečinok mimo neho môžu použiť len správcovia. Názov začínajúci `cu_` ukazuje na váš vlastný blok upstream v nginx (pozrite Load balancing vo wiki).
- **Port presmerovania**: voliteľné. Pri `path` je to verzia PHP.
- **Skupina**: voľná menovka, ktorá udržiava dlhé zoznamy prehľadné.
- **Možnosti** (všetky predvolene vypnuté):
  - **Odosielať hlavičku noindex a blokovať niektoré boty (user agent)**: požiada vyhľadávače, aby stránku neindexovali, a zablokuje niektoré crawlery.
  - **Vypnúť CrowdSec AppSec**: vypne CrowdSec AppSec len pre tohto hostiteľa. Má účinok iba vtedy, ak je AppSec nastavený.
  - **Vypnúť vyrovnávanie požiadaviek** a **Vypnúť vyrovnávanie odpovedí**: pre upstreamy http a https. Vyrovnávanie nechajte zapnuté, pokiaľ nestreamujete alebo nenahrávate veľké súbory cez rýchle a stabilné spojenie. Vypnutie vyrovnávania požiadaviek vypne aj AppSec.
  - **Zapnúť kompresiu upstreamom**: nechá službu komprimovať vlastné odpovede. Nechajte vypnuté, pokiaľ to služba nepotrebuje. Nie pre `path` a `empty`.
  - **Zapnúť fancyindex**: zobrazí zoznam súborov, ak priečinok nemá indexový súbor. Len pre `path`.
- **X-Frame-Options**: `SAMEORIGIN` (predvolené), `DENY`, `none` (odstráni hlavičku) alebo `upstream` (ponechá, čo pošle služba).
- **Auth Request**: dá pred hostiteľa prihlásenie alebo kontrolu botov (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Predvolene `none`. **Upstream pre Auth Request** je voliteľný; prázdny použije predvolenú hodnotu z Nastavenia, Preposielané overovanie.
- **Globálne zoznamy prístupov**: **Verejne prístupné** (predvolené, bez prihlásenia) alebo **Vlastný**, jeden alebo viac zoznamov prístupov.

Websockets sú vždy zapnuté.

### Vlastné umiestnenia

Umiestnenie posiela jednu cestu hostiteľa (napríklad `/api/`) na inú službu. Každé má **Aktivované**, cestu s voliteľným typom zhody (`=`, `~`, `~*`, `^~` alebo `@`), vlastnú schému, hostiteľa, port, možnosti, Auth Request a zoznamy prístupov. Jeho zoznam prístupov môže byť **Globálny**, čo používa zoznamy hostiteľa. Auth Request hostiteľa nededí. K ceste pridajte koncové lomítko, ak nechcete zhodu podľa predpony. Správcovia môžu tlačidlom ozubeného kolesa pridať vlastnú konfiguráciu nginx pre každé umiestnenie.

### TLS

- **TLS certifikát**: Žiadny, Vyžiadať nový certifikát, alebo existujúci. Nižšie uvedené možnosti vyžadujú certifikát.
- **Certifikát mTLS**: certifikačná autorita klientskych certifikátov. **mTLS voliteľné** pustí dnu aj návštevníkov bez certifikátu. **mTLS obchádza Auth Request** nechá návštevníkov s platným certifikátom preskočiť Auth Request.
- **Vynútiť HTTPS** presmeruje HTTP na HTTPS. **Podpora HTTP/3** povolí HTTP/3 (QUIC).
- **HSTS zapnuté (2 roky)**: vyžaduje Vynútiť HTTPS. **HSTS pre subdomény + preload** vyžaduje HSTS.
- Pre nový certifikát: **Znova použiť kľúč (neodporúča sa)** a **Použiť DNS výzvu**, s poskytovateľom, prihlasovacími údajmi a sekundami propagácie.

### Pokročilé

Vlastná konfigurácia nginx pre celého hostiteľa (blok server) a pre hlavné umiestnenie `location /`. Môžu ju meniť len správcovia.

Viac vo wiki: Host options.
