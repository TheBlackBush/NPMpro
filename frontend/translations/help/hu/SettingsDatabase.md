## Adatbázis

Az adatbázis, amelyben az NPMpro a kiszolgálókat, tanúsítványokat, felhasználókat, naplókat és statisztikákat tárolja. Alapértelmezetten ez az SQLite, egyetlen fájl, és ez az ajánlott választás. Innen mindent áthelyezhet MySQL-be, MariaDB-be, PostgreSQL-be vagy egy új SQLite-fájlba. A használt adatbázist az áthelyezés nem módosítja.

### Használt adatbázis

Megmutatja a motort és a verziót, hogy hol van, a méretét és a kapcsolat **Forrás**át: **Alapértelmezett** (az SQLite-fájl `/data/npmpro/database.sqlite`), **Adatbázis-beállítási fájl** (`/data/npmpro/database.json`, áthelyezés írja) vagy **Környezet** (`DB_MYSQL_*` vagy `DB_POSTGRES_*` változók). Áthelyezés után kiírja, mikor és melyik motorról helyezte át.

### Táblák

Minden tábla a soraival és méretével. A kártya összecsukható.

### Áthelyezés másik adatbázisba

Előbb hozzon létre a szerverén egy üres adatbázist és egy felhasználót, aki táblákat hozhat létre; az NPMpro nem hozza létre az adatbázist. Követelmények: MySQL 8.0, MariaDB 10.6 vagy PostgreSQL 13, illetve újabb.

1. Válassza ki a **Motor**t, és adja meg a **Kiszolgáló**t, a **Port**ot, az **Adatbázis neve**t, a **Felhasználó**t és a **Jelszó**t. Kapcsolja be a **TLS használata** beállítást, ha a szerver megköveteli (MySQL és MariaDB esetén a **A szerver tanúsítványának ellenőrzése** és a **A szerver nevének ellenőrzése** is használható). Az SQLite-ba áthelyezéshez semmi nem kell: új fájlt hoz létre a `/data/npmpro` mappában.
2. **Kapcsolat tesztelése**. Ellenőrzi a verziót, hogy az adatbázis üres-e, és hogy a felhasználó létrehozhat-e táblákat. Semmit nem módosít.
3. **Áthelyezés**, majd írja be a kért szót, és kattintson az **Áthelyezés most** gombra.

Az NPMpro szünetelteti a módosításokat, biztonsági mentést készít, létrehozza a táblákat, átmásolja és ellenőrzi minden sort, majd az új adatbázison újraindul. Az oldalai közben is kiszolgálásra kerülnek. Az oldal újratölt, amikor az NPMpro újra válaszol, és előfordulhat, hogy újra be kell jelentkeznie.

Ha egy lépés sikertelen, az NPMpro a korábban használt adatbázison marad, és az ablak megnevezi a megakadt lépést. A régi adatbázist soha nem törli, így visszatérhet: törölje a `/data/npmpro/database.json` fájlt, és indítsa újra a konténert.

Ha a kapcsolat `DB_MYSQL_*` vagy `DB_POSTGRES_*` változókból származik, a szakasz csak olvasható. Az áthelyezéshez készítsen mentést, irányítsa a változókat az új adatbázisra, indítsa újra, és állítsa vissza a mentést.

Továbbiak a wikiben: Database.
