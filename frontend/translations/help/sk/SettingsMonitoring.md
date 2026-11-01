## Logy a monitorovanie

Súbory logov, report logov GoAccess a štatistiky prevádzky, na ktorých stojí stránka Monitorovanie.

Premenná nastavená na kontajneri má prednosť pred používateľským rozhraním a zamkne pole (pole zobrazí odznak zámku, napríklad "Nastavené cez LOGROTATE", alebo "Nastavené prostredím" pri štatistikách). Pre všetko, čo nie je nastavené v kontajneri, použite rozhranie. Nastavenia označené "Restart required" sa uložia okamžite, ale načítajú sa pri štarte kontajnera; sekcia ich potom uvedie pod "Na použitie reštartujte kontajner".

### Súbory logov

- **Zapisovať súbory logov**: zapisuje logy nginx error, stream a access do `/data/nginx/logs` a denne ich rotuje. Predvolené: vypnuté. Premenná: `LOGROTATE`. Použije sa po reloade nginx, ktorý uloženie spustí. Zostane zapnuté, kým beží GoAccess.
- **Počet uchovaných rotácií logov**: koľko rotovaných súborov logov sa uchová, kým sa najstarší zmaže, 1 až 1000. Predvolené: 3. Premenná: `LOGROTATIONS`. Použije sa okamžite.

### GoAccess

- **Report GoAccess**: spustí GoAccess, webový report logov pre správcov, pod `/goaccess` webového rozhrania. Predvolené: vypnuté. Premenná: `GOA`. Použije sa po reštarte kontajnera. Nezapína štatistiky prevádzky.

Keď je report zapnutý, zobrazia sa tieto možnosti. Všetky sa použijú po reštarte kontajnera. Jedna premenná, `GOACLA`, ich všetky nahradí vašimi vlastnými možnosťami GoAccess a zamkne ich.

- **Uchovávať údaje reportu**: 1 až 366 dní. Predvolené: 30.
- **Anonymizovať IP návštevníkov**: Vypnuté, Úroveň 1 (predvolené), Úroveň 2 (silná) alebo Úroveň 3 (puntičkárska). Úroveň 1 skryje posledný bajt IPv4 (posledných 64 bitov IPv6), úroveň 2 dva bajty (80 bitov), úroveň 3 tri bajty (96 bitov).
- **Odstrániť query string**: odstráni query stringy z URL v reporte, takže sa neukladajú tokeny v URL. Predvolené: zapnuté.
- **Úplné verzie operačných systémov**: zobrazí úplnú verziu, nielen rodinu. Predvolené: zapnuté.
- **Prekladať názvy hostiteľov**: vyhľadáva názvy hostiteľov pre IP návštevníkov. Posiela to na ne DNS dopyty. Predvolené: zapnuté.

### Monitorovanie

Tieto riadia kartu Prevádzka na stránke Monitorovanie. Všetky sa použijú okamžite po uložení. Premenné: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Štatistiky prevádzky**: číta access log nginx a počíta požiadavky podľa hostiteľa, stavu, krajiny a siete. Predvolené: vypnuté. Vypnutie zastaví nové počítanie; uložené štatistiky zostanú, kým nezostarnú, pokiaľ v dialógu nezaškrtnete "Vymazať aj uložené štatistiky".
- **Uchovávať štatistiky počas**: 7 až 365 dní. Predvolené: 30. Údaje po minútach sa uchovávajú 24 hodín, údaje po hodinách toľko dní.
- **Zobrazovať IP návštevníkov**: ukladá IP návštevníkov po hodinách, aby vypísal najčastejšie IP. Predvolené: vypnuté, z dôvodu súkromia. Vypnutie zmaže uložené IP.
- **Počítať unikátnych návštevníkov**: ukladá hash s kľúčom z každej IP návštevníka na hostiteľa a deň, aby spočítal unikátnych návštevníkov. Predvolené: vypnuté. Vypnutie zmaže hashe.
- **Limit návštevníkov na hostiteľa a deň**: 1000 až 1000000. Predvolené: 100000. Hostiteľ, ktorý ho dosiahne, ten deň prestane počítať nových návštevníkov a zobrazí znak plus.

Krajiny a siete vyžadujú databázy GeoIP (Nastavenia, GeoIP).

Viac vo wiki: Monitoring.
