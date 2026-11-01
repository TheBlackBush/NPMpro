## GeoIP

NPMpro si samo sťahuje bezplatné databázy MaxMind GeoLite2 a vyhľadáva krajiny a siete na vašom serveri, takže IP návštevníkov sa nikam neposielajú. Samostatný kontajner geoipupdate nepotrebujete. Databázy napájajú mapu a zoznamy v Monitorovaní, GoAccess a pravidlá krajín v nginx.

Premenná nastavená na kontajneri má prednosť pred používateľským rozhraním a zamkne pole (pole zobrazí "Nastavené prostredím"). Pre všetko, čo nie je nastavené v kontajneri, použite rozhranie. Uloženie spustí sťahovanie na pozadí a stav nižšie sa aktualizuje po dokončení.

### Účet MaxMind

Potrebujete bezplatný účet MaxMind a licenčný kľúč (v MaxMind: Account, Manage license keys). Na stránke je odkaz na registráciu.

- **ID účtu**: premenná `GEOIP_ACCOUNT_ID`.
- **Licenčný kľúč**: uložený zašifrovaný a už sa nezobrazí. Ak sa uložený kľúč nedá dešifrovať, zadajte ho znova. Premenná: `GEOIP_LICENSE_KEY`.

### Databázy

- **GeoLite2 Country**: krajiny pre mapu, zoznamy krajín a pravidlá krajín v nginx. Predvolene zapnuté.
- **GeoLite2 ASN**: siete (číslo AS a názov) pre zoznamy sietí. Predvolene zapnuté.
- **GeoLite2 City**: voliteľné, mestá pre GoAccess. Oveľa väčšie sťahovanie. Predvolene vypnuté.

Premenná: `GEOIP_EDITIONS`, oddelená medzerami, napríklad `GeoLite2-Country GeoLite2-ASN`. Ak nie je vybraná žiadna databáza, nič sa nesťahuje ani neaktualizuje a už stiahnuté databázy zostanú.

### Stav

Zobrazí poslednú aktualizáciu a poslednú chybu. NPMpro aktualizuje databázy, keď zmeníte účet alebo databázy, keď kliknete na **Aktualizovať teraz**, a automaticky každé 3 dni. Neúspešná automatická aktualizácia sa skúsi znova po 24 hodinách. **Aktualizovať teraz** vyžaduje uložené ID účtu a licenčný kľúč.

Bez databáz sú mapa a zoznamy krajín a sietí skryté; zvyšok funguje.

Viac vo wiki: Monitoring.
