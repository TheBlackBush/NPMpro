## Pomoc s certifikátmi

### Certifikát HTTP

Certifikát overený protokolom HTTP znamená, že servery Certbot sa
pokúsia pripojiť k vašim doménam cez protokol HTTP (nie HTTPS!) a v prípade úspechu
vydajú váš certifikát.

Pre túto metódu budete musieť mať pre svoje domény vytvorený _Proxy Host_, ktorý
je prístupný cez HTTP a smeruje na túto inštaláciu Nginx. Po vydaní certifikátu
môžete zmeniť _Proxy Host_ tak, aby tento certifikát používal aj pre HTTPS
pripojenia. _Proxy Host_ však bude stále potrebné nakonfigurovať pre prístup cez HTTP,
aby sa certifikát mohol obnoviť.

Tento proces _nepodporuje_ domény s divokými kartami.

### Certifikát DNS

Certifikát overený DNS vyžaduje použitie pluginu DNS Provider. Tento DNS
Provider sa použije na vytvorenie dočasných záznamov vo vašej doméne a potom Certbot
overí tieto záznamy, aby sa uistil, že ste vlastníkom, a ak bude úspešný,
vydá váš certifikát.

Pred požiadaním o tento typ certifikátu nie je potrebné vytvoriť _Proxy Host_.
Tiež nie je potrebné mať _Proxy Host_ nakonfigurovaný pre prístup HTTP.

Tento proces _podporuje_ domény s divokými kartami.

#### Uložené prihlasovacie údaje DNS

Prihlasovacie údaje pre vášho DNS Providera sa ukladajú oddelene od certifikátu, na
karte _Prihlasovacie údaje DNS_ na stránke Certifikáty. Certifikát potom iba vyberie jeden
z uložených prihlasovacích údajov, takže ich môže zdieľať viac certifikátov.

Tajné hodnoty sa ukladajú šifrovane a už sa nikdy znova nezobrazia. Pri úprave prihlasovacích údajov
nechajte tajnú hodnotu prázdnu, ak chcete zachovať uloženú hodnotu. Kľúč použitý na šifrovanie je súbor
`/data/npmpro/dns-credentials.key`, zálohujte ho spolu s databázou, inak
uložené prihlasovacie údaje nebude možné po obnovení prečítať.

Provideri bez formulára používajú textové pole INI, do ktorého vložíte obsah
súboru s prihlasovacími údajmi pre daného providera.

### Vlastný certifikát

Túto možnosť použite na nahratie vlastného TLS certifikátu, ktorý vám poskytla vaša
certifikačná autorita.
