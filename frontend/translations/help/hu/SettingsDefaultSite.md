## Alapértelmezett oldal

Az alapértelmezett oldal az, amit az nginx válaszol, ha a látogató olyan hosztnévvel éri el az NPMpro-t, amelyet egyetlen kiszolgáló sem használ, vagy a szerver IP-címével. Itt választhatja ki a választ. Minden ismeretlen névre érvényes.

A mentés előbb teszteli az új választást az nginxszel. Ha a teszt sikertelen, semmi nem mentődik, a korábbi alapértelmezett oldal marad, és az nginx hibája a konténer naplójában van.

- **Gratulálunk oldal** (alapértelmezett): az NPMpro üdvözlő oldalát mutatja.
- **404-es oldal**: 404 Not Found oldallal válaszol.
- **Nincs válasz (444)**: válasz nélkül bontja a kapcsolatot. Használja, hogy a szkennerek semmit se lássanak. Az ismeretlen nevekre érkező HTTPS-kéréseket a TLS-kézfogás közben elutasítja.
- **Átirányítás**: ideiglenes átirányítással (302) másik címre küldi a látogatókat. Adjon meg teljes `http://` vagy `https://` URL-t szóközök, idézőjelek és `; { } #` nélkül, legfeljebb 255 karakter.
- **Egyéni HTML**: saját HTML-oldalt mutat. Az alatta lévő **HTTP-állapotkód** nem kötelező, 400 és 599 között. Hagyja üresen a 200 (OK) értékhez.

A Nincs válasz kivételével minden választásnál az ismeretlen nevekre érkező sima HTTP-kéréseket előbb HTTPS-re irányítja át, a HTTPS-kérések pedig a Beállítások, Tanúsítványok és TLS alatt **Alapértelmezett tanúsítvány**ként kiválasztott tanúsítványt használják.

Ennek a szakasznak nincsenek környezeti változói, ezért a módosítás mentéskor lép életbe.
