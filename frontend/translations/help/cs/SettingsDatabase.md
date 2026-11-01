## Databáze

Databáze, do které NPMpro ukládá své hostitele, certifikáty, uživatele, logy a statistiky. Ve výchozím stavu je to SQLite, jediný soubor, a je to doporučená volba. Odtud můžete vše přesunout do MySQL, MariaDB, PostgreSQL nebo do nového souboru SQLite. Používaná databáze se přesunem nemění.

### Používaná databáze

Zobrazí engine a verzi, kde se nachází, její velikost a **Zdroj** připojení: **Výchozí** (soubor SQLite `/data/npmpro/database.sqlite`), **Soubor nastavení databáze** (`/data/npmpro/database.json`, zapisuje ho přesun) nebo **Prostředí** (proměnné `DB_MYSQL_*` nebo `DB_POSTGRES_*`). Po přesunu uvádí, kdy a z jakého enginu jste přesunuli.

### Tabulky

Každá tabulka s počtem řádků a velikostí. Kartu lze sbalit.

### Přesunout do jiné databáze

Nejdříve na svém serveru vytvořte prázdnou databázi a uživatele, který může vytvářet tabulky; NPMpro databázi nevytváří. Požadavky: MySQL 8.0, MariaDB 10.6 nebo PostgreSQL 13 či novější.

1. Vyberte **Engine** a zadejte **Hostitel**, **Port**, **Název databáze**, **Uživatel** a **Heslo**. Zapněte **Použít TLS**, pokud to server vyžaduje (u MySQL a MariaDB můžete také **Kontrolovat certifikát serveru** a **Kontrolovat název serveru**). Přesun do SQLite nepotřebuje nic: vytvoří nový soubor v `/data/npmpro`.
2. **Otestovat připojení**. Zkontroluje verzi, že je databáze prázdná a že uživatel může vytvářet tabulky. Nic nemění.
3. **Přesunout**, poté napište požadované slovo a klikněte na **Přesunout nyní**.

NPMpro pozastaví změny, vytvoří bezpečnostní zálohu, vytvoří tabulky, zkopíruje a zkontroluje každý řádek a poté se restartuje na nové databázi. Vaše weby se dál obsluhují. Stránka se znovu načte, až NPMpro opět odpoví, a možná se budete muset znovu přihlásit.

Pokud některý krok selže, NPMpro zůstane na databázi, kterou používal, a okno uvede krok, který se zastavil. Stará databáze se nikdy nemaže, takže se můžete vrátit: odstraňte `/data/npmpro/database.json` a restartujte kontejner.

Pokud připojení pochází z proměnných `DB_MYSQL_*` nebo `DB_POSTGRES_*`, je sekce jen pro čtení. Pro přesun vytvořte zálohu, nasměrujte proměnné na novou databázi, restartujte a obnovte zálohu.

Více ve wiki: Database.
