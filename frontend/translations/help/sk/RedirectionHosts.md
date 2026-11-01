## Čo je presmerovací hostiteľ?

Presmerovací hostiteľ posiela návštevníkov jednej domény na inú adresu. Použite ho, keď stránka zmení doménu a staré odkazy majú ďalej fungovať, alebo na presmerovanie `www` na hlavné meno.

Pomocou **Klonovať** v ponuke hostiteľa skopírujete hostiteľa do nového okna Pridať. Kópia začína bez doménových mien, pretože doména môže patriť len jednému zapnutému hostiteľovi.

### Podrobnosti

- **Doménové mená**: mená, ktoré sa presmerúvajú. Povinné. Zástupné znaky sú pri novom certifikáte povolené len s DNS výzvou.
- **Schéma**: schéma cieľa. "zachovať (rovnaké ako požiadavka)" je predvolené a zachová `http` alebo `https` z návštevy. Alebo vyberte `http` či `https`.
- **Cieľová doména**: doména, kam sa návštevníci posielajú, napríklad `example.com`. Povinné.
- **HTTP kód**: kód odpovede. Predvolene 301 Moved permanently. Ďalšie možnosti: 302 Moved temporarily, 303 See other, 307 Temporary redirect a 308 Permanent redirect. Použite 301 alebo 308, keď je presun trvalý; prehliadače a vyhľadávače si ich pamätajú.
- **Skupina**: voľná menovka, ktorá udržiava dlhé zoznamy prehľadné. Vyberte používanú alebo napíšte nový názov.
- **Zachovať cestu** (predvolene vypnuté): pridá k cieľu pôvodnú cestu a query. Keď je zapnuté, `old.example/a?b=1` smeruje na `new.example/a?b=1`. Bez toho sa každý návštevník ocitne na začiatku cieľa.

### TLS

- **TLS certifikát**: Žiadny, Vyžiadať nový certifikát, alebo existujúci. Nižšie uvedené možnosti vyžadujú certifikát.
- **Certifikát mTLS**: certifikačná autorita klientskych certifikátov. **mTLS voliteľné** pustí dnu aj návštevníkov bez klientskeho certifikátu.
- **Vynútiť HTTPS**: najprv presmeruje HTTP na HTTPS.
- **Podpora HTTP/3**: povolí HTTP/3 (QUIC).
- **HSTS zapnuté (2 roky)**: vyžaduje Vynútiť HTTPS. **HSTS pre subdomény + preload** vyžaduje HSTS.
- Pre nový certifikát: **Znova použiť kľúč (neodporúča sa)** a **Použiť DNS výzvu**, s poskytovateľom, prihlasovacími údajmi a sekundami propagácie.

Všetky možnosti TLS sú predvolene vypnuté.

### Pokročilé

Vlastná konfigurácia nginx pridaná do bloku server hostiteľa. Môžu ju meniť len správcovia; ostatní používatelia ju vidia len na čítanie.

Viac vo wiki: Host options.
