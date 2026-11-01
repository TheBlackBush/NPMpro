## Preposielané overovanie

Preposielané overovanie dá pred proxy hostiteľa prihlásenie alebo kontrolu botov. Pri každej požiadavke sa nginx najprv opýta overovacej služby, či návštevník smie prejsť. NPMpro to má vstavané pre Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia a Authentik. Poskytovateľa spúšťate vo vlastnom kontajneri.

Táto stránka nastavuje predvolenú adresu (upstream) každého poskytovateľa. Proxy hostiteľ zapne kontrolu cez **Auth Request** v Možnostiach na karte Podrobnosti (alebo pri vlastnom umiestnení).

Premenná nastavená na kontajneri má prednosť pred používateľským rozhraním a zamkne pole (pole zobrazí odznak zámku, napríklad "Nastavené cez AUTH_REQUEST_AUTHELIA_UPSTREAM"). Pre všetko, čo nie je nastavené v kontajneri, použite rozhranie. Každé nastavenie sa tu použije po reloade nginx, ktorý uloženie spustí. Ak test nginx zlyhá, nič sa neuloží.

### Predvolené upstreamy

- **Upstream Anubis**, **Upstream Tinyauth**, **Upstream OAuth2 Proxy**, **Upstream VoidAuth**, **Upstream Authelia**, **Upstream Authentik**: používajú ich proxy hostitelia s týmto poskytovateľom, ktorí nemajú vlastný upstream. Hodnota samotného hostiteľa vyhráva. Predvolené: prázdne (žiadny). Premenné: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Formát: `scheme://host:port`, napríklad `http://127.0.0.1:9091`, alebo `scheme://cu_name` pre váš vlastný blok upstream v nginx, ktorého názov začína `cu_`. Použite `http` alebo `https`; port je povinný; adresa IPv6 patrí do hranatých zátvoriek. Bez cesty, bez medzier a bez znakov `; { } # " ' $ \`.

Predvolenú hodnotu nemožno vyprázdniť, kým proxy hostitelia používajú tohto poskytovateľa bez vlastného upstreamu. Správa tých hostiteľov vymenuje.

Hostiteľ, ktorý používa poskytovateľa bez upstreamu kdekoľvek, dostane "Chyba konfigurácie".

### Anubis

- **Vlastné obrázky Anubis**: zobrazuje vaše vlastné `happy.webp`, `reject.webp` a `pensive.webp` na stránkach výziev Anubis. Predvolené: zapnuté, keď existujú všetky tri súbory a nie sú prázdne, inak vypnuté. Premenná: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. Obrázky patria do `public/anubis` vo vašom dátovom priečinku.

Viac vo wiki: Forward-Authentication.
