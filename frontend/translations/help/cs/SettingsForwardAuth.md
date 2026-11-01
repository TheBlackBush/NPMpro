## Předávané ověřování

Předávané ověřování postaví před proxy hostitele přihlášení nebo kontrolu botů. Pro každý požadavek se nginx nejdříve zeptá ověřovací služby, zda smí návštěvník projít. NPMpro to má vestavěné pro Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia a Authentik. Poskytovatele spouštíte ve vlastním kontejneru.

Tato stránka nastavuje výchozí adresu (upstream) každého poskytovatele. Proxy hostitel zapne kontrolu pomocí **Auth Request** v Možnostech na kartě Podrobnosti (nebo u vlastního umístění).

Proměnná nastavená na kontejneru má přednost před rozhraním a zamkne pole (pole ukazuje odznak se zámkem, například "Nastaveno přes AUTH_REQUEST_AUTHELIA_UPSTREAM"). Rozhraní používejte pro vše, co není nastaveno na kontejneru. Každé nastavení zde se použije po reloadu nginx, který uložení provede. Pokud test nginx selže, nic se neuloží.

### Výchozí upstreamy

- **Upstream Anubis**, **Upstream Tinyauth**, **Upstream OAuth2 Proxy**, **Upstream VoidAuth**, **Upstream Authelia**, **Upstream Authentik**: používají proxy hostitelé s tímto poskytovatelem, kteří nemají vlastní upstream. Vlastní hodnota hostitele vyhrává. Výchozí: prázdné (žádný). Proměnné: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Formát: `scheme://host:port`, například `http://127.0.0.1:9091`, nebo `scheme://cu_name` pro váš vlastní blok upstream v nginx, jehož název začíná `cu_`. Použijte `http` nebo `https`; port je povinný; adresa IPv6 patří do hranatých závorek. Bez cesty, bez mezer a bez kteréhokoli z `; { } # " ' $ \`.

Výchozí hodnotu nelze vyprázdnit, dokud proxy hostitelé používají tohoto poskytovatele bez vlastního upstreamu. Zpráva tyto hostitele vypíše.

Hostitel, který používá poskytovatele bez upstreamu kdekoli, dostane "Chyba konfigurace".

### Anubis

- **Vlastní obrázky Anubis**: zobrazí vaše `happy.webp`, `reject.webp` a `pensive.webp` na stránkách výzev Anubis. Výchozí: zapnuto, když všechny tři soubory existují a nejsou prázdné, jinak vypnuto. Proměnná: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. Obrázky patří do `public/anubis` ve vaší datové složce.

Více ve wiki: Forward-Authentication.
