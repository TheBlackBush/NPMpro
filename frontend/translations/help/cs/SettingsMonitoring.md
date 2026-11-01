## Logy a monitorování

Soubory logů, report logů GoAccess a statistiky provozu, které stojí za stránkou Monitorování.

Proměnná nastavená na kontejneru má přednost před rozhraním a zamkne pole (pole ukazuje odznak se zámkem, například "Nastaveno přes LOGROTATE", nebo "Nastaveno prostředím" u statistik). Rozhraní používejte pro vše, co není nastaveno na kontejneru. Nastavení označená "Vyžadován restart" se uloží okamžitě, ale přečtou se při spuštění kontejneru; sekce je pak uvede pod "Pro použití restartujte kontejner".

### Soubory logů

- **Zapisovat soubory logů**: zapisuje logy chyb, stream a přístupu nginx do `/data/nginx/logs` a rotuje je denně. Výchozí: vypnuto. Proměnná: `LOGROTATE`. Použije se po reloadu nginx, který uložení provede. Zůstane zapnuto, dokud běží GoAccess.
- **Počet uchovaných rotací logů**: kolik rotovaných souborů logů se uchová, než se nejstarší smaže, od 1 do 1000. Výchozí: 3. Proměnná: `LOGROTATIONS`. Použije se okamžitě.

### GoAccess

- **Report GoAccess**: spustí GoAccess, webový report logů pro správce, pod `/goaccess` webového rozhraní. Výchozí: vypnuto. Proměnná: `GOA`. Použije se po restartu kontejneru. Nezapíná statistiky provozu.

Při zapnutém reportu se zobrazí tyto volby. Všechny se použijí po restartu kontejneru. Jedna proměnná, `GOACLA`, je všechny nahradí vašimi vlastními volbami GoAccess a zamkne je.

- **Uchovávat data reportu**: 1 až 366 dní. Výchozí: 30.
- **Anonymizovat IP návštěvníků**: Off, Level 1 (výchozí), Level 2 (strong) nebo Level 3 (pedantic). Úroveň 1 skryje poslední bajt IPv4 (posledních 64 bitů IPv6), úroveň 2 dva bajty (80 bitů), úroveň 3 tři bajty (96 bitů).
- **Odstranit query string**: odstraní query string z URL v reportu, takže se tokeny v URL neukládají. Výchozí: zapnuto.
- **Úplné verze operačních systémů**: zobrazí úplnou verzi, ne jen rodinu. Výchozí: zapnuto.
- **Překládat názvy hostitelů**: vyhledá názvy hostitelů IP adres návštěvníků. Odesílají se pro ně dotazy DNS. Výchozí: zapnuto.

### Monitorování

Řídí kartu Provoz na stránce Monitorování. Všechny se po uložení použijí okamžitě. Proměnné: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Statistiky provozu**: čte přístupový log nginx a počítá požadavky podle hostitele, stavu, země a sítě. Výchozí: vypnuto. Vypnutí zastaví nové počítání; uložené statistiky zůstanou, dokud nezestárnou, pokud v dialogu nezaškrtnete "Smazat také uložené statistiky".
- **Uchovávat statistiky po dobu**: 7 až 365 dní. Výchozí: 30. Minutová data se uchovávají 24 hodin, hodinová data tolik dní.
- **Zobrazovat IP návštěvníků**: ukládá IP návštěvníků po hodinách, aby bylo možné vypsat nejčastější IP. Výchozí: vypnuto, kvůli soukromí. Vypnutí uložené IP smaže.
- **Počítat unikátní návštěvníky**: ukládá hash s klíčem každé IP návštěvníka na hostitele a den pro počítání unikátních návštěvníků. Výchozí: vypnuto. Vypnutí hashe smaže.
- **Limit návštěvníků na hostitele a den**: 1000 až 1000000. Výchozí: 100000. Hostitel, který ho dosáhne, přestane ten den počítat nové návštěvníky a zobrazí znaménko plus.

Země a sítě potřebují databáze GeoIP (Nastavení, GeoIP).

Více ve wiki: Monitoring.
