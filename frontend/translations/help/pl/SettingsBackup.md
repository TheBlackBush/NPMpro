## Kopia zapasowa i przywracanie

Zapisz swoje hosty, certyfikaty, użytkowników i ustawienia do pliku `.npmpro` i przywróć go na tej lub innej instancji NPMpro. Statystyki ruchu i logi nigdy nie wchodzą w skład kopii zapasowej.

### Utwórz kopię zapasową

- **Co uwzględnić**: części takie jak hosty, listy dostępu, certyfikaty, poświadczenia DNS, użytkownicy, ustawienia i pliki własne. Na początku wszystkie są zaznaczone.
- **Uwzględnij sekrety**: dodaje klucze prywatne, hasła, sekrety uwierzytelniania dwuskładnikowego, wartości poświadczeń DNS, sekret klienta OIDC i klucz licencyjny GeoIP. Plik jest szyfrowany **Hasłem** o długości co najmniej 12 znaków, które wpisujesz dwa razy. NPMpro go nie przechowuje, więc bez niego kopii nie da się przywrócić.
- Bez sekretów plik nie jest szyfrowany i pomija sekrety. Nadal zawiera nazwy hostów, użytkowników i ustawienia, więc trzymaj go w tajemnicy.
- **Pobierz** zapisuje plik na Twoim komputerze. **Zachowaj na serwerze** zapisuje go w `/data/backups`.

### Zaplanowane kopie zapasowe

Dodaj harmonogramy, które same tworzą kopie zapasowe i zapisują je na serwerze.

- **Kiedy**: co N godzin, codziennie, co tydzień lub co miesiąc, w strefie czasowej kontenera.
- **Ochrona**: **Hasło** (przywracanie gdziekolwiek), **Klucz instancji** (nic do zapamiętania, przywracanie tylko na tej instancji) lub **Bez sekretów**.
- **Zachowywane**: ile plików tego harmonogramu zachować. Starsze są usuwane po każdym udanym uruchomieniu.
- Harmonogram można uruchomić od razu, wstrzymać, edytować lub usunąć. Nieudane uruchomienie jest pokazywane przy harmonogramie i na pulpicie.

Zaplanowane kopie zapasowe chronią przed złymi zmianami, nie przed utratą dysku. Do tego skopiuj pliki na inną maszynę.

### Zapisane kopie zapasowe

Wypisuje pliki na serwerze. Pobierz je, przywróć lub usuń albo użyj **Prześlij kopię zapasową**. NPMpro tworzy kopię **Automatyczne** przed każdym przywróceniem, scaleniem i przeniesieniem bazy danych; nie wymaga hasła i przywraca się tylko na tej instancji.

### Przywracanie

- **Zastąp** podmienia wybrane części na tej instancji na te z kopii zapasowej. Twoje własne konto nigdy nie jest zastępowane.
- **Scal** dodaje elementy z kopii zapasowej i niczego nie usuwa. Pokazuje podgląd i pozwala wybrać dla każdego konfliktu: pominąć, użyć istniejącego elementu, dodać jako nowy lub zastąpić.

Przywracanie jest cofane, jeśli nginx odrzuci wynik. Kopii zapasowej z nowszej wersji NPMpro nie można przywrócić. Niektóre przywrócone ustawienia wymagają ponownego uruchomienia kontenera.

Ta sekcja nie ma zmiennych środowiskowych.

Więcej w wiki: Backup-and-restore.
