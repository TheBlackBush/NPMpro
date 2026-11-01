## GeoIP

NPMpro si sám stahuje bezplatné databáze MaxMind GeoLite2 a vyhledává země a sítě na vašem serveru, takže se IP adresy návštěvníků nikam neposílají. Nepotřebujete samostatný kontejner geoipupdate. Databáze napájejí mapu a seznamy Monitorování, GoAccess a pravidla zemí v nginx.

Proměnná nastavená na kontejneru má přednost před rozhraním a zamkne pole (pole ukazuje "Nastaveno prostředím"). Rozhraní používejte pro vše, co není nastaveno na kontejneru. Uložení spustí stahování na pozadí a stav níže se po dokončení aktualizuje.

### Účet MaxMind

Potřebujete bezplatný účet MaxMind a licenční klíč (v MaxMind: Account, Manage license keys). Na stránce je odkaz pro registraci.

- **ID účtu**: proměnná `GEOIP_ACCOUNT_ID`.
- **Licenční klíč**: ukládá se zašifrovaný a už se nezobrazí. Pokud uložený klíč nelze dešifrovat, zadejte ho znovu. Proměnná: `GEOIP_LICENSE_KEY`.

### Databáze

- **GeoLite2 Country**: země pro mapu, seznamy zemí a pravidla zemí v nginx. Ve výchozím stavu zapnuto.
- **GeoLite2 ASN**: sítě (číslo a název AS) pro seznamy sítí. Ve výchozím stavu zapnuto.
- **GeoLite2 City**: volitelná, města pro GoAccess. Mnohem větší stahování. Ve výchozím stavu vypnuto.

Proměnná: `GEOIP_EDITIONS`, oddělená mezerami, například `GeoLite2-Country GeoLite2-ASN`. Pokud není vybrána žádná databáze, nic se nestahuje ani neaktualizuje a již stažené databáze zůstanou.

### Stav

Zobrazí poslední aktualizaci a poslední chybu. NPMpro aktualizuje databáze, když změníte účet nebo databáze, když kliknete na **Aktualizovat nyní**, a automaticky každé 3 dny. Neúspěšná automatická aktualizace se zkusí znovu po 24 hodinách. **Aktualizovat nyní** vyžaduje uložené ID účtu a licenční klíč.

Bez databází jsou mapa a seznamy zemí a sítí skryté; zbytek funguje.

Více ve wiki: Monitoring.
