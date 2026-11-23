## Dynamic DNS

Hoe NPMpro de records van het tabblad Dynamic DNS (Certificaten) gericht houdt op zijn openbare adres. Er wordt niets gecontroleerd totdat een record is ingeschakeld.

Een variabele die op de container is gezet gaat voor op de interface en vergrendelt het veld (het veld toont een slotbadge zoals "Ingesteld door DDNS_PERIOD"). Gebruik de interface voor alles wat niet in de container is ingesteld.

- **Controleer elke**: hoe vaak de records worden gecontroleerd, van `1m` tot `24h` (bijvoorbeeld `5m` of `1h30m`). Standaard: `5m`. Variabele: `DDNS_PERIOD`. Een wijziging herstart de timer.
- **Afkoeltijd**: de kortste tijd tussen twee schrijfacties van één record, in hetzelfde formaat. Standaard: `5m`. Variabele: `DDNS_COOLDOWN`.
- **IPv4-adresdiensten** en **IPv6-adresdiensten**: `https://`-URL's die met het openbare adres antwoorden. Een nieuw adres wordt alleen geschreven als twee diensten het eens zijn. De IPv6-diensten worden alleen gevraagd zolang een ingeschakeld record IPv6 nodig heeft. Variabelen: `DDNS_IPV4_SERVICES`, `DDNS_IPV6_SERVICES` (gescheiden door spaties). Een dienst waarvan het adres de server niet mag aanroepen (een privé- of lokaal adres) wordt geweigerd.
- **DNS-servers**: de servers waarmee de adresdiensten en de providers worden opgelost. Leeg gebruikt de resolvers van de container. Een IPv4-adres, of een IPv6-adres tussen haakjes, met een optionele poort. Variabele: `DDNS_RESOLVER` (gescheiden door spaties).

Records worden toegevoegd op het tabblad Dynamic DNS met DNS-inloggegevens van een provider die records kan bijwerken.
