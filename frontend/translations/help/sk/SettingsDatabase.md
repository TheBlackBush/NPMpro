## Databáza

Databáza, v ktorej NPMpro uchováva hostiteľov, certifikáty, používateľov, logy a štatistiky. Predvolene je to SQLite, jeden súbor, a je to odporúčaná voľba. Odtiaľto môžete všetko presunúť do MySQL, MariaDB, PostgreSQL alebo do nového súboru SQLite. Používaná databáza sa presunom nemení.

### Používaná databáza

Zobrazí engine a verziu, kde sa nachádza, jej veľkosť a **Zdroj** pripojenia: **Predvolené** (súbor SQLite `/data/npmpro/database.sqlite`), **Súbor nastavení databázy** (`/data/npmpro/database.json`, zapísaný presunom) alebo **Prostredie** (premenné `DB_MYSQL_*` alebo `DB_POSTGRES_*`). Po presune uvádza, kedy a z akého enginu ste presunuli.

### Tabuľky

Každá tabuľka s počtom riadkov a veľkosťou. Kartu možno zbaliť.

### Presun do inej databázy

Najprv na svojom serveri vytvorte prázdnu databázu a používateľa, ktorý môže vytvárať tabuľky; NPMpro databázu nevytvára. Požiadavky: MySQL 8.0, MariaDB 10.6 alebo PostgreSQL 13 či novšie.

1. Vyberte **Engine** a zadajte **Hostiteľ**, **Port**, **Názov databázy**, **Používateľ** a **Heslo**. Ak to server vyžaduje, zapnite **Použiť TLS** (pri MySQL a MariaDB môžete aj **Kontrolovať certifikát servera** a **Kontrolovať názov servera**). Presun do SQLite nepotrebuje nič: vytvorí nový súbor v `/data/npmpro`.
2. **Otestovať pripojenie**. Skontroluje verziu, že databáza je prázdna a že používateľ môže vytvárať tabuľky. Nič nemení.
3. **Presunúť**, potom napíšte slovo, ktoré sa pýta, a kliknite na **Presunúť teraz**.

NPMpro pozastaví zmeny, vytvorí bezpečnostnú zálohu, vytvorí tabuľky, skopíruje a skontroluje každý riadok a potom sa reštartuje na novej databáze. Vaše stránky sa naďalej obsluhujú. Stránka sa znova načíta, keď NPMpro opäť odpovie, a možno sa budete musieť znova prihlásiť.

Ak krok zlyhá, NPMpro zostane na databáze, ktorú používal, a okno uvedie krok, ktorý sa zastavil. Stará databáza sa nikdy nemaže, takže sa môžete vrátiť: odstráňte `/data/npmpro/database.json` a reštartujte kontajner.

Ak pripojenie pochádza z premenných `DB_MYSQL_*` alebo `DB_POSTGRES_*`, sekcia je len na čítanie. Na presun urobte zálohu, nasmerujte premenné na novú databázu, reštartujte a obnovte zálohu.

Viac vo wiki: Database.
