## Dynamiczny DNS

Jak NPMpro utrzymuje rekordy z karty Dynamiczny DNS (Certyfikaty) skierowane na swój publiczny adres. Nic nie jest sprawdzane, dopóki nie włączysz rekordu.

Zmienna ustawiona w kontenerze ma pierwszeństwo przed interfejsem i blokuje pole (pole pokazuje znaczek kłódki, na przykład „Ustawione przez DDNS_PERIOD”). Wszystko, czego nie ustawiono w kontenerze, zmieniaj w interfejsie.

- **Sprawdzaj co**: jak często rekordy są sprawdzane, od `1m` do `24h` (na przykład `5m` lub `1h30m`). Domyślnie: `5m`. Zmienna: `DDNS_PERIOD`. Zmiana restartuje zegar.
- **Czas odstępu**: najkrótszy czas między dwoma zapisami jednego rekordu, w tym samym formacie. Domyślnie: `5m`. Zmienna: `DDNS_COOLDOWN`.
- **Usługi adresu IPv4** i **Usługi adresu IPv6**: adresy URL `https://`, które odpowiadają publicznym adresem. Nowy adres jest zapisywany tylko wtedy, gdy dwie usługi się zgadzają. Usługi IPv6 są odpytywane tylko wtedy, gdy włączony rekord potrzebuje IPv6. Zmienne: `DDNS_IPV4_SERVICES`, `DDNS_IPV6_SERVICES` (oddzielone spacjami). Usługa, której adresu serwer nie może wywołać (adres prywatny lub lokalny), jest odrzucana.
- **Serwery DNS**: serwery używane do rozwiązywania nazw usług adresu i dostawców. Puste oznacza resolwery kontenera. Adres IPv4 lub adres IPv6 w nawiasach kwadratowych, z opcjonalnym portem. Zmienna: `DDNS_RESOLVER` (oddzielone spacjami).

Rekordy dodaje się na karcie Dynamiczny DNS, używając danych uwierzytelniających DNS dostawcy, który potrafi aktualizować rekordy.
