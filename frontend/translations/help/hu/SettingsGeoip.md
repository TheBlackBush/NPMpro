## GeoIP

Az NPMpro maga tölti le az ingyenes MaxMind GeoLite2 adatbázisokat, és a szerverén keresi fel az országokat és hálózatokat, így a látogatók IP-címei sehová nem kerülnek elküldésre. Nincs szüksége külön geoipupdate konténerre. Az adatbázisok a Monitorozás térképét és listáit, a GoAccesst és az nginx országszabályait látják el.

A konténeren beállított változó felülírja a felületet, és zárolja a mezőt (a mező ezt mutatja: "Környezeti változó állítja be"). Amit nem a konténerben állított be, azt a felületen adja meg. A mentés a háttérben elindítja a letöltést, és az alábbi állapot a végén frissül.

### MaxMind fiók

Ingyenes MaxMind fiókra és licenckulcsra van szüksége (a MaxMindben: Account, Manage license keys). Az oldalon van egy regisztrációs link.

- **Fiókazonosító**: változó `GEOIP_ACCOUNT_ID`.
- **Licenckulcs**: titkosítva tárolva, és többé nem jelenik meg. Ha a mentett kulcsot nem lehet visszafejteni, adja meg újra. Változó: `GEOIP_LICENSE_KEY`.

### Adatbázisok

- **GeoLite2 Country**: országok a térképhez, az országlistákhoz és az nginx országszabályaihoz. Alapból be.
- **GeoLite2 ASN**: hálózatok (AS-szám és név) a hálózati listákhoz. Alapból be.
- **GeoLite2 City**: nem kötelező, városok a GoAccesshez. Sokkal nagyobb letöltés. Alapból ki.

Változó: `GEOIP_EDITIONS`, szóközzel elválasztva, például `GeoLite2-Country GeoLite2-ASN`. Ha nincs adatbázis kiválasztva, semmi nem töltődik le vagy frissül, a már letöltött adatbázisok megmaradnak.

### Állapot

Megmutatja az utolsó frissítést és az utolsó hibát. Az NPMpro frissíti az adatbázisokat, ha módosítja a fiókot vagy az adatbázisokat, ha a **Frissítés most** gombra kattint, és automatikusan 3 naponta. A sikertelen automatikus frissítést 24 óra múlva újra megpróbálja. A **Frissítés most** mentett fiókazonosítót és licenckulcsot igényel.

Adatbázisok nélkül a térkép, valamint az ország- és hálózati listák rejtve vannak; minden más működik.

Továbbiak a wikiben: Monitoring.
