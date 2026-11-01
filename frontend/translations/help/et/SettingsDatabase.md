## Andmebaas

Andmebaas, kus NPMpro hoiab oma hoste, sertifikaate, kasutajaid, logisid ja statistikat. Vaikimisi on selleks SQLite, üks fail, ja see on soovitatav valik. Siit saad kõik teisaldada MySQL-i, MariaDB-sse, PostgreSQL-i või uude SQLite'i faili. Kasutusel olevat andmebaasi teisaldamine ei muuda.

### Kasutusel olev andmebaas

Näitab mootorit ja versiooni, kus see asub, selle suurust ja ühenduse **Allikas**t: **Vaikimisi** (SQLite'i fail `/data/npmpro/database.sqlite`), **Andmebaasi seadete fail** (`/data/npmpro/database.json`, kirjutatud teisaldamisel) või **Keskkond** (muutujad `DB_MYSQL_*` või `DB_POSTGRES_*`). Pärast teisaldamist ütleb see, millal ja millisest mootorist teisaldasid.

### Tabelid

Iga tabel koos ridade ja suurusega. Kaardi saab kokku voltida.

### Teisalda teise andmebaasi

Loo oma serveris esmalt tühi andmebaas ja kasutaja, kes saab tabeleid luua; NPMpro andmebaasi ei loo. Nõuded: MySQL 8.0, MariaDB 10.6 või PostgreSQL 13 või uuem.

1. Vali **Mootor** ja sisesta **Host**, **Port**, **Andmebaasi nimi**, **Kasutaja** ja **Parool**. Lülita sisse **Kasuta TLS-i**, kui server seda nõuab (MySQL-i ja MariaDB puhul saad kasutada ka **Kontrolli serveri sertifikaati** ja **Kontrolli serveri nime**). SQLite'i teisaldamine ei vaja midagi: see loob uue faili kausta `/data/npmpro`.
2. **Testi ühendust**. See kontrollib versiooni, et andmebaas on tühi ja et kasutaja saab tabeleid luua. See ei muuda midagi.
3. **Teisalda**, seejärel sisesta sõna, mida küsitakse, ja klõpsa **Teisalda kohe**.

NPMpro peatab muudatused, teeb turvavarukoopia, loob tabelid, kopeerib ja kontrollib iga rea ning taaskäivitub seejärel uuel andmebaasil. Sinu saite serveeritakse edasi. Leht laaditakse uuesti, kui NPMpro taas vastab, ja võib olla vaja uuesti sisse logida.

Kui samm ebaõnnestub, jääb NPMpro andmebaasile, mida ta kasutas, ja aken nimetab sammu, mis peatus. Vana andmebaasi ei kustutata kunagi, nii et saad tagasi minna: eemalda `/data/npmpro/database.json` ja taaskäivita konteiner.

Kui ühendus tuleb muutujatest `DB_MYSQL_*` või `DB_POSTGRES_*`, on jaotis ainult lugemiseks. Teisaldamiseks tee varukoopia, suuna muutujad uuele andmebaasile, taaskäivita ja taasta varukoopia.

Rohkem wikis: Database.
