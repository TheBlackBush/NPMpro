## Hálózat

Adja meg az NPMpro-nak, hogy az előtte lévő proxyk közül melyeknek hihet a valódi kliens címét illetően. Enélkül a naplók, a hozzáférési listák és a CrowdSec a proxy címét látják, nem a látogatóét.

A konténeren beállított változó felülírja a felületet, és zárolja a mezőt (a mező zár jelvényt mutat, például "Beállítja: TRUST_IP"). Amit nem a konténerben állított be, azt a felületen adja meg.

- **Megbízható proxy IP-k**: soronként egy IPv4- vagy IPv6-cím, illetve CIDR-tartomány, például `10.0.0.0/8`, `192.168.1.5` vagy `fd00::/8`. Az ezekről a címekről érkező kérések az `X-Forwarded-For` fejlécben átadhatják a valódi kliens IP-jét. Használja közvetlenül az NPMpro előtt álló terheléselosztóhoz vagy alagúthoz. Alapértelmezett: üres (senkiben nem bízik). Változó: `TRUST_IP` (szóközzel elválasztva). A mentéskor futó nginx-újratöltés után lép életbe.
- **Cloudflare megbízhatónak tekintése**: lekéri a Cloudflare IP-tartományait, rendszeresen frissíti, és megbízik bennük, így az nginx a Cloudflare mögött a valódi kliens-IP-ket látja. Alapértelmezett: ki. Változó: `TRUST_CLOUDFLARE`. A mentéskor futó nginx-újratöltés után lép életbe. Előbb olvassa el a Cloudflare-ről szóló megjegyzéseket a wikiben (Security): a Cloudflare NPMpro elé helyezésének adatvédelmi és biztonsági ára van.

Csak olyan címekben bízzon, amelyeket Ön irányít vagy teljesen megbízhatónak tart. Egy megbízható cím bármely látogatónak kiadhatja magát.

Ha a mentés nem megy át az nginx-teszten, semmi nem mentődik, és az nginx üzenete jelenik meg.

Továbbiak a wikiben: Security.
