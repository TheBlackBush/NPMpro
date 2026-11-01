## Mi az a hozzáférési lista?

A hozzáférési lista proxy kiszolgálókat véd. Kérhet a látogatóktól felhasználónevet és jelszót (Basic hitelesítés), engedélyezhet vagy tilthat látogatókat IP-cím alapján, vagy mindkettőt. Hasznos olyan szolgáltatásoknál, amelyeknek nincs saját bejelentkezésük, vagy ha az ismeretlen klienseket távol szeretné tartani.

Egy lista több proxy kiszolgálón és útvonalon is használható.

### Részletek

- **Név**: kötelező.
- **Bármely teljesítése** (alapból ki): a látogató bejut, ha bármelyik egy ellenőrzésnek megfelel, legyen az szabály vagy érvényes felhasználó. Kikapcsolva mindkettőn át kell mennie. Az adott kiszolgálón az Auth Requestet is kihagyja.
- **Hitelesítés továbbítása az upstream felé** (alapból ki): a látogató `Authorization` fejlécét továbbküldi a szolgáltatásnak. Kikapcsolva a bejelentkezés az NPMpro-n belül marad.

### Hitelesítések

Adjon hozzá felhasználóneveket és jelszavakat. A felhasználónevek a listán belül egyediek legyenek, és nem tartalmazhatnak `:` karaktert. Lista szerkesztésekor a mentett jelszót hagyja üresen, ha meg szeretné tartani.

### Szabályok

A szabályok egy IP-címet, egy CIDR-tartományt (`192.168.1.0/24`, `2001:db8::/32`) vagy a `unix:` értéket engedélyezik vagy tiltják. A megadás sorrendjében érvényesülnek, és az első találat nyer. A konkrét szabályokat tegye előre. Egy záró `all` szabály zárja le a listát, engedélyezésre vagy tiltásra állítva; csak akkor kerül be, ha legalább egy másik szabály van. A listához legalább egy felhasználó vagy egy szabály kell.

### Használat proxy kiszolgálókon

Egy proxy kiszolgálónál a Részletek lapon a **Globális hozzáférési listák** alatt válassza ki a listát: **Nyilvánosan elérhető** (nincs lista) vagy **Egyéni**. Egy egyéni útvonal használhatja a **Globális** értéket (a kiszolgáló listáit), a **Nyilvánosan elérhető** értéket vagy a saját **Egyéni** listáit.

Egy kiszolgálóhoz vagy útvonalhoz több listát is rendelhet. Fentről lefelé, a megjelenített sorrendben ellenőrzik őket, és föl-le mozgathatók. A **Bármely teljesítése** és a **Hitelesítés továbbítása az upstream felé** csak az első listán számít. CrowdSec esetén a kitiltott IP-k a jelszókérés előtt a kitiltási oldalt látják.

Továbbiak a wikiben: Host options.
