## Mi az az átirányító kiszolgáló?

Az átirányító kiszolgáló egy domain látogatóit egy másik címre küldi. Használja, ha egy oldal domaint vált, és a régi linkeknek tovább kell működniük, vagy a `www` főnévre küldéséhez.

A kiszolgáló menüjében a **Klónozás** egy új Hozzáadás ablakba másolja a kiszolgálót. A másolat domain nevek nélkül indul, mert egy domain csak egy engedélyezett kiszolgálóhoz tartozhat.

### Részletek

- **Domain nevek**: az átirányított nevek. Kötelező. Helyettesítő karakteres nevek új tanúsítványnál csak DNS-kihívással engedélyezettek.
- **Séma**: a cél sémája. A "keep (a kéréssel megegyező)" az alapértelmezett, és megtartja a látogatás `http` vagy `https` sémáját. Vagy válassza a `http` vagy `https` értéket.
- **Továbbító domain**: a domain, ahová a látogatók kerülnek, például `example.com`. Kötelező.
- **HTTP kód**: a válaszkód. Alapértelmezett: 301 Moved permanently. További lehetőségek: 302 Moved temporarily, 303 See other, 307 Temporary redirect és 308 Permanent redirect. Használja a 301 vagy 308 értéket, ha a költözés végleges; a böngészők és a keresők megjegyzik ezeket.
- **Csoport**: szabad címke, amely rendezetten tartja a hosszú listákat. Válasszon egy használatban lévőt, vagy írjon be új nevet.
- **Útvonal megőrzése** (alapból ki): hozzáadja az eredeti elérési utat és a lekérdezést a célhoz. Bekapcsolva az `old.example/a?b=1` a `new.example/a?b=1` címre kerül. Nélküle minden látogató a cél elejére érkezik.

### TLS

- **TLS tanúsítvány**: Nincs, Új tanúsítvány kérelmezése, vagy egy meglévő. Az alábbi beállításokhoz tanúsítvány kell.
- **mTLS tanúsítvány**: egy kliens-tanúsítvány hitelesítésszolgáltató. Az **Az mTLS legyen opcionális** beengedi a kliens-tanúsítvány nélküli látogatókat.
- **HTTPS kényszerítése**: előbb a HTTP-t HTTPS-re irányítja át.
- **HTTP/3 támogatás**: engedélyezi a HTTP/3-at (QUIC).
- **HSTS engedélyezve (2 év)**: a HTTPS kényszerítése kell hozzá. A **HSTS aldomainek+Preload** a HSTS-t igényli.
- Új tanúsítványhoz: **Kulcs újrahasználása (nem ajánlott)** és **DNS Challenge használata**, szolgáltatóval, hitelesítő adattal és terjedési másodpercekkel.

Minden TLS-beállítás alapból ki van kapcsolva.

### Speciális

Egyéni nginx konfiguráció, amely a kiszolgáló server blokkjába kerül. Csak rendszergazdák módosíthatják; a többi felhasználó csak olvasásra látja.

Továbbiak a wikiben: Host options.
