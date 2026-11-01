## GeoIP

NPMpro sam pobiera darmowe bazy danych MaxMind GeoLite2 i wyszukuje kraje i sieci na Twoim serwerze, więc adresy IP odwiedzających nigdy nie są nigdzie wysyłane. Nie potrzebujesz osobnego kontenera geoipupdate. Bazy zasilają mapę i listy Monitorowania, GoAccess i reguły krajów w nginx.

Zmienna ustawiona w kontenerze ma pierwszeństwo przed interfejsem i blokuje pole (pole pokazuje "Ustawione przez środowisko"). Używaj interfejsu dla wszystkiego, czego nie ustawiono w kontenerze. Zapis uruchamia pobieranie w tle, a stan poniżej aktualizuje się po jego zakończeniu.

### Konto MaxMind

Potrzebujesz darmowego konta MaxMind i klucza licencyjnego (w MaxMind: Account, Manage license keys). Na stronie jest link do rejestracji.

- **ID konta**: zmienna `GEOIP_ACCOUNT_ID`.
- **Klucz licencyjny**: przechowywany zaszyfrowany i nigdy więcej nie pokazywany. Jeśli zapisanego klucza nie da się odszyfrować, wpisz go ponownie. Zmienna: `GEOIP_LICENSE_KEY`.

### Bazy danych

- **GeoLite2 Country**: kraje dla mapy, list krajów i reguł krajów w nginx. Domyślnie włączona.
- **GeoLite2 ASN**: sieci (numer i nazwa AS) dla list sieci. Domyślnie włączona.
- **GeoLite2 City**: opcjonalna, miasta dla GoAccess. Znacznie większe pobieranie. Domyślnie wyłączona.

Zmienna: `GEOIP_EDITIONS`, oddzielona spacjami, na przykład `GeoLite2-Country GeoLite2-ASN`. Gdy nie wybrano żadnej bazy, nic nie jest pobierane ani aktualizowane, a już pobrane bazy zostają.

### Stan

Pokazuje ostatnią aktualizację i ostatni błąd. NPMpro aktualizuje bazy, gdy zmienisz konto lub bazy, gdy klikniesz **Aktualizuj teraz**, oraz automatycznie co 3 dni. Nieudana automatyczna aktualizacja jest ponawiana po 24 godzinach. **Aktualizuj teraz** wymaga zapisanego ID konta i klucza licencyjnego.

Bez baz mapa oraz listy krajów i sieci są ukryte; reszta działa.

Więcej w wiki: Monitoring.
