## Logi i monitorowanie

Pliki logów, raport logów GoAccess i statystyki ruchu stojące za stroną Monitorowanie.

Zmienna ustawiona w kontenerze ma pierwszeństwo przed interfejsem i blokuje pole (pole pokazuje znaczek z kłódką, taki jak "Ustawione przez LOGROTATE", lub "Ustawione przez środowisko" dla statystyk). Używaj interfejsu dla wszystkiego, czego nie ustawiono w kontenerze. Ustawienia oznaczone "Wymagane ponowne uruchomienie" są zapisywane od razu, ale odczytywane przy starcie kontenera; sekcja wymienia je wtedy pod "Uruchom ponownie kontener, aby zastosować".

### Pliki logów

- **Zapisuj pliki logów**: zapisuje logi błędów, stream i dostępu nginx w `/data/nginx/logs` i rotuje je codziennie. Domyślnie: wyłączone. Zmienna: `LOGROTATE`. Działa po przeładowaniu nginx, które wykonuje zapis. Pozostaje włączone, dopóki działa GoAccess.
- **Zachowywane rotacje logów**: ile obróconych plików logów jest zachowywanych, zanim najstarszy zostanie usunięty, od 1 do 1000. Domyślnie: 3. Zmienna: `LOGROTATIONS`. Działa od razu.

### GoAccess

- **Raport GoAccess**: uruchamia GoAccess, raport logów webowych dla administratorów, pod `/goaccess` interfejsu webowego. Domyślnie: wyłączone. Zmienna: `GOA`. Działa po ponownym uruchomieniu kontenera. Nie włącza statystyk ruchu.

Gdy raport jest włączony, pokazują się te opcje. Wszystkie działają po ponownym uruchomieniu kontenera. Jedna zmienna, `GOACLA`, zastępuje je wszystkie Twoimi własnymi opcjami GoAccess i je blokuje.

- **Przechowuj dane raportu**: od 1 do 366 dni. Domyślnie: 30.
- **Anonimizuj adresy IP odwiedzających**: Off, Level 1 (domyślnie), Level 2 (strong) lub Level 3 (pedantic). Poziom 1 ukrywa ostatni bajt IPv4 (ostatnie 64 bity IPv6), poziom 2 dwa bajty (80 bitów), poziom 3 trzy bajty (96 bitów).
- **Usuwaj query string**: usuwa query string z adresów URL w raporcie, aby tokeny w adresach URL nie były przechowywane. Domyślnie: włączone.
- **Pełne wersje systemów operacyjnych**: pokazuje pełną wersję, nie tylko rodzinę. Domyślnie: włączone.
- **Rozwiązuj nazwy hostów**: wyszukuje nazwy hostów adresów IP odwiedzających. To wysyła dla nich zapytania DNS. Domyślnie: włączone.

### Monitorowanie

Sterują kartą Ruch na stronie Monitorowanie. Wszystkie działają od razu po zapisie. Zmienne: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Statystyki ruchu**: czyta log dostępu nginx i zlicza żądania według hosta, statusu, kraju i sieci. Domyślnie: wyłączone. Wyłączenie zatrzymuje nowe zliczanie; zapisane statystyki zostają, aż się zestarzeją, chyba że zaznaczysz "Usuń też zapisane statystyki" w oknie.
- **Przechowuj statystyki przez**: od 7 do 365 dni. Domyślnie: 30. Dane minutowe są przechowywane przez 24 godziny, dane godzinowe przez tyle dni.
- **Pokazuj adresy IP odwiedzających**: zapisuje adresy IP odwiedzających na godzinę, aby wypisać najczęstsze IP. Domyślnie: wyłączone, ze względu na prywatność. Wyłączenie usuwa zapisane adresy IP.
- **Zliczaj unikalnych odwiedzających**: zapisuje skrót z kluczem każdego adresu IP odwiedzającego na host i dzień, aby zliczać unikalnych odwiedzających. Domyślnie: wyłączone. Wyłączenie usuwa skróty.
- **Limit odwiedzających na host i dzień**: od 1000 do 1000000. Domyślnie: 100000. Host, który go osiągnie, przestaje liczyć nowych odwiedzających tego dnia i pokazuje znak plus.

Kraje i sieci wymagają baz GeoIP (Ustawienia, GeoIP).

Więcej w wiki: Monitoring.
