## Hitelesítés

Bejelentkezés az NPMpro webes felületére egy OIDC-szolgáltatóval (például Authentik, Keycloak vagy Google), a jelszavak mellett vagy helyett. Ez nem továbbított hitelesítés: nem védi a proxy kiszolgálókat. Ahhoz lásd: Beállítások, Továbbított hitelesítés.

A konténeren beállított változó felülírja a felületet, és zárolja a mezőt (a mező ezt mutatja: "Környezeti változó állítja be"). Ha mind a négy kapcsolati változó be van állítva, az OIDC a felületen való bekapcsolás nélkül is aktív. Amit nem a konténerben állított be, azt a felületen adja meg. Itt minden mentéskor lép életbe.

### Szolgáltató

- **OIDC bejelentkezés engedélyezése**: megjeleníti a bejelentkezési gombot a bejelentkezési oldalon.
- **Kibocsátó URL**: a szolgáltató discovery alapcíme, például `https://accounts.example.com`. Változó: `OIDC_ISSUER_URL`.
- **Kliensazonosító** és **Kliens titok**: a szolgáltatótól. A titkot titkosítva tárolja, és többé nem mutatja; hagyja üresen, ha meg szeretné tartani. Ha a kibocsátó URL-t vagy a kliensazonosítót módosítja, adja meg újra a titkot. Változók: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Átirányítási domain**: a domain, amellyel az emberek megnyitják az NPMpro-t, porttal, ha az nem 443. Kötelező, mert ebből áll össze a visszahívási URL. Változó: `OIDC_REDIRECT_DOMAIN`.
- **Visszahívási URL**: csak olvasható. Regisztrálja átirányítási URI-ként a szolgáltatónál.
- **Scope-ok**: alapértelmezett: `openid email profile`. Módosítsa, ha a szolgáltatója csak egy részüket engedi, például `openid email`.
- **Kapcsolat tesztelése**: ellenőrzi, hogy az NPMpro eléri-e a kibocsátót.

### Bejelentkezési gomb

A bejelentkezési oldalon lévő gomb: **Megjelenített név** (a "Bejelentkezés ezzel:" utáni szöveg), **Szín** (előre beállított vagy saját `#rrggbb`) és **Ikon** (beépített, PNG, JPEG, WebP vagy SVG formátumban feltöltött, legfeljebb 256 KB, vagy URL-ről letöltött). Előnézet is megjelenik.

### Bejelentkezési szabályok

- **Megerősített e-mail cím megkövetelése**: elutasítja azokat a felhasználókat, akiknek az e-mail-címét a szolgáltatójuk nem erősítette meg. Alapértelmezett: be. Változó: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Kétlépcsős azonosítás kihagyása OIDC után**: megbízik a szolgáltató saját többtényezős ellenőrzésében. Alapértelmezett: ki. Változó: `OIDC_SKIP_MFA`.
- **Jelszavas bejelentkezés letiltása**: csak OIDC-vel lehet bejelentkezni. Csak olyan munkamenetből kapcsolhatja be, amely OIDC-vel jelentkezett be. Változó: `OIDC_DISABLE_PASSWORD`; a jelszavas bejelentkezés visszaállításához állítsa `false` értékre, és hozza létre újra a konténert.

### Új felhasználók

- **Felhasználók létrehozása az első bejelentkezéskor** (alapból ki): aki nem rendelkezik fiókkal, az alább megadott jogosultságokkal kap egyet.
- **Engedélyezett e-mail domainek**: vesszővel elválasztva; üresen bármely domain engedélyezett. Üres lista és nem kötelező megerősített e-mail esetén bárki kap fiókot, akit a szolgáltatója elfogad.
- **Új felhasználók alapértelmezett jogosultságai**: szakaszonként állítható. Az új felhasználók soha nem rendszergazdák.

Továbbiak a wikiben: Authentication.
