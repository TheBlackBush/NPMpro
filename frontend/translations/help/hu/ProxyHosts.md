## Mi az a proxy kiszolgáló?

A proxy kiszolgáló egy webszolgáltatás bejárata. A látogatók az Ön domainjét nyitják meg az NPMpro-ban, az NPMpro pedig továbbítja a kérést a mögötte lévő szolgáltatásnak. TLS-t (HTTPS) is adhat olyan szolgáltatásokhoz, amelyeknek nincs saját. A proxy kiszolgálók az NPMpro leggyakoribb felhasználási módja.

A kiszolgáló menüjében a **Klónozás** egy új Hozzáadás ablakba másolja a kiszolgálót. A másolat domain nevek nélkül indul, mert egy domain csak egy engedélyezett kiszolgálóhoz tartozhat.

### Részletek

- **Domain nevek**: a látogatók által használt nevek. Kötelező. Új tanúsítványnál a helyettesítő karakteres nevekhez (`*.example.com`) DNS-kihívás kell.
- **Séma**: ahogy az NPMpro a szolgáltatással beszél: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (fájlok vagy PHP kiszolgálása egy mappából) vagy `empty` (nincs upstream). Alapértelmezett: `http://`. A séma váltása kikapcsolja a hozzá nem illő beállításokat.
- **Továbbítási hosztnév / IP / útvonal**: a szolgáltatás címe. Megadhat alútvonalat is, például `127.0.0.1/path`. `path` esetén ehelyett mappát adjon meg. A fájlokat a `/var/www` alá csatolja; a rajta kívüli mappát csak rendszergazdák használhatják. A `cu_` kezdetű név a saját nginx upstream blokkjára mutat (lásd a wikiben a Load balancing részt).
- **Továbbító port**: nem kötelező. `path` esetén ez a PHP-verzió.
- **Csoport**: szabad címke, amely rendezetten tartja a hosszú listákat.
- **Beállítások** (alapból mind ki):
  - **noindex fejléc küldése és egyes bot user agentek blokkolása**: kéri a keresőket, hogy ne indexeljék az oldalt, és blokkol néhány robotot.
  - **CrowdSec AppSec letiltása**: csak ennél a kiszolgálónál kapcsolja ki a CrowdSec AppSec-et. Csak akkor van hatása, ha az AppSec be van állítva.
  - **Kérés pufferelésének letiltása** és **Válasz pufferelésének letiltása**: http és https upstreamekhez. Hagyja bekapcsolva a pufferelést, kivéve ha gyors, stabil kapcsolaton streamel vagy nagy fájlokat tölt fel. A kérés pufferelésének kikapcsolása az AppSec-et is kikapcsolja.
  - **Tömörítés engedélyezése az upstream által**: engedi, hogy a szolgáltatás maga tömörítse a válaszait. Hagyja kikapcsolva, hacsak a szolgáltatásnak nincs rá szüksége. `path` és `empty` esetén nem.
  - **fancyindex engedélyezése**: fájllistát mutat, ha a mappában nincs index fájl. Csak `path` esetén.
- **X-Frame-Options**: `SAMEORIGIN` (alapértelmezett), `DENY`, `none` (eltávolítja a fejlécet) vagy `upstream` (megtartja, amit a szolgáltatás küld).
- **Auth Request**: bejelentkezést vagy botellenőrzést tesz a kiszolgáló elé (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Alapértelmezett: `none`. Az **Auth Request upstream** nem kötelező; üresen a Beállítások, Továbbított hitelesítés alapértéke érvényes.
- **Globális hozzáférési listák**: **Nyilvánosan elérhető** (alapértelmezett, nincs bejelentkezés) vagy **Egyéni**, egy vagy több hozzáférési lista.

A websocketek mindig be vannak kapcsolva.

### Egyéni útvonalak

Egy útvonal a kiszolgáló egyetlen elérési útját (például `/api/`) küldi egy másik szolgáltatásnak. Mindegyiknek van **Engedélyezve** kapcsolója, egy elérési útja nem kötelező egyezési típussal (`=`, `~`, `~*`, `^~` vagy `@`), saját sémája, hosztja, portja, beállításai, Auth Requestje és hozzáférési listái. A hozzáférési listája lehet **Globális**, ami a kiszolgáló listáit használja. A kiszolgáló Auth Requestjét nem örökli. Az elérési úthoz tegyen záró perjelet, hacsak nem előtag-egyezést szeretne. A rendszergazdák a fogaskerék gombbal egyéni nginx konfigurációt adhatnak hozzá útvonalanként.

### TLS

- **TLS tanúsítvány**: Nincs, Új tanúsítvány kérelmezése, vagy egy meglévő. Az alábbi beállításokhoz tanúsítvány kell.
- **mTLS tanúsítvány**: egy kliens-tanúsítvány hitelesítésszolgáltató. Az **Az mTLS legyen opcionális** beengedi a tanúsítvány nélküli látogatókat. Az **Az mTLS megkerüli az Auth Requestet** engedi, hogy az érvényes tanúsítvánnyal rendelkező látogatók kihagyják az Auth Requestet.
- A **HTTPS kényszerítése** a HTTP-t HTTPS-re irányítja át. A **HTTP/3 támogatás** engedélyezi a HTTP/3-at (QUIC).
- **HSTS engedélyezve (2 év)**: a HTTPS kényszerítése kell hozzá. A **HSTS aldomainek+Preload** a HSTS-t igényli.
- Új tanúsítványhoz: **Kulcs újrahasználása (nem ajánlott)** és **DNS Challenge használata**, szolgáltatóval, hitelesítő adattal és terjedési másodpercekkel.

### Speciális

Egyéni nginx konfiguráció a teljes kiszolgálóhoz (server blokk) és a fő útvonalhoz, a `location /`-hez. Csak rendszergazdák módosíthatják.

Továbbiak a wikiben: Host options.
