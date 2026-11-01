## Továbbított hitelesítés

A továbbított hitelesítés bejelentkezést vagy botellenőrzést tesz egy proxy kiszolgáló elé. Minden kérésnél az nginx előbb megkérdez egy hitelesítő szolgáltatást, hogy a látogató átmehet-e. Az NPMpro ezt beépítve tartalmazza az Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia és Authentik számára. A szolgáltatót saját konténerben futtatja.

Ez az oldal az egyes szolgáltatók alapértelmezett címét (upstream) állítja be. A proxy kiszolgáló a Részletek lapon a Beállítások alatti **Auth Request** mezővel (vagy egy egyéni útvonalon) kapcsolja be az ellenőrzést.

A konténeren beállított változó felülírja a felületet, és zárolja a mezőt (a mező zár jelvényt mutat, például "Beállítja: AUTH_REQUEST_AUTHELIA_UPSTREAM"). Amit nem a konténerben állított be, azt a felületen adja meg. Itt minden beállítás a mentéskor futó nginx-újratöltés után lép életbe. Ha az nginx-teszt sikertelen, semmi nem mentődik.

### Alapértelmezett upstreamek

- **Anubis upstream**, **Tinyauth upstream**, **OAuth2 Proxy upstream**, **VoidAuth upstream**, **Authelia upstream**, **Authentik upstream**: azok a proxy kiszolgálók használják, amelyek az adott szolgáltatóval rendelkeznek, de nincs saját upstreamjük. A kiszolgáló saját értéke nyer. Alapértelmezett: üres (nincs). Változók: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Formátum: `scheme://host:port`, például `http://127.0.0.1:9091`, vagy `scheme://cu_name` a saját, `cu_` kezdetű nevű nginx upstream blokkjához. Használjon `http` vagy `https` sémát; a port kötelező; az IPv6-címet szögletes zárójelbe kell tenni. Nincs elérési út, szóköz, és egyik sem a következők közül: `; { } # " ' $ \`.

Nem ürítheti ki az alapértéket, amíg proxy kiszolgálók használják az adott szolgáltatót saját upstream nélkül. Az üzenet felsorolja ezeket a kiszolgálókat.

Az a kiszolgáló, amely olyan szolgáltatót használ, amelyhez sehol nincs upstream, "Konfigurációs hiba" jelzést kap.

### Anubis

- **Egyéni Anubis képek**: a saját `happy.webp`, `reject.webp` és `pensive.webp` fájljait mutatja az Anubis kihívás-oldalain. Alapértelmezett: be, ha mindhárom fájl létezik és nem üres, egyébként ki. Változó: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. A képek az adatmappa `public/anubis` mappájába kerülnek.

Továbbiak a wikiben: Forward-Authentication.
