## Baza danych

Baza danych, w której NPMpro przechowuje hosty, certyfikaty, użytkowników, logi i statystyki. Domyślnie jest to SQLite, pojedynczy plik, i jest to zalecany wybór. Stąd możesz przenieść wszystko do MySQL, MariaDB, PostgreSQL lub nowego pliku SQLite. Używana baza danych nie jest zmieniana przez przeniesienie.

### Używana baza danych

Pokazuje silnik i wersję, gdzie się znajduje, jej rozmiar oraz **Źródło** połączenia: **Domyślne** (plik SQLite `/data/npmpro/database.sqlite`), **Plik ustawień bazy danych** (`/data/npmpro/database.json`, zapisywany przez przeniesienie) lub **Środowisko** (zmienne `DB_MYSQL_*` lub `DB_POSTGRES_*`). Po przeniesieniu podaje, kiedy i z jakiego silnika przeniesiono.

### Tabele

Każda tabela z liczbą wierszy i rozmiarem. Kartę można zwinąć.

### Przenieś do innej bazy danych

Najpierw utwórz na swoim serwerze pustą bazę danych i użytkownika, który może tworzyć tabele; NPMpro nie tworzy bazy danych. Wymagania: MySQL 8.0, MariaDB 10.6 lub PostgreSQL 13 albo nowsze.

1. Wybierz **Silnik** i wpisz **Host**, **Port**, **Nazwa bazy danych**, **Użytkownik** i **Hasło**. Włącz **Użyj TLS**, jeśli serwer tego wymaga (dla MySQL i MariaDB możesz też **Sprawdzaj certyfikat serwera** i **Sprawdzaj nazwę serwera**). Przeniesienie do SQLite niczego nie wymaga: tworzy nowy plik w `/data/npmpro`.
2. **Testuj połączenie**. Sprawdza wersję, czy baza danych jest pusta i czy użytkownik może tworzyć tabele. Niczego nie zmienia.
3. **Przenieś**, następnie wpisz słowo, o które jest prośba, i kliknij **Przenieś teraz**.

NPMpro wstrzymuje zmiany, tworzy kopię zapasową dla bezpieczeństwa, tworzy tabele, kopiuje i sprawdza każdy wiersz, a potem uruchamia się ponownie na nowej bazie danych. Twoje witryny są nadal obsługiwane. Strona przeładowuje się, gdy NPMpro znowu odpowie, i może być konieczne ponowne zalogowanie.

Jeśli krok się nie powiedzie, NPMpro pozostaje na używanej bazie danych, a okno wskazuje krok, który się zatrzymał. Stara baza danych nigdy nie jest usuwana, więc możesz wrócić: usuń `/data/npmpro/database.json` i uruchom kontener ponownie.

Jeśli połączenie pochodzi ze zmiennych `DB_MYSQL_*` lub `DB_POSTGRES_*`, sekcja jest tylko do odczytu. Aby przenieść, zrób kopię zapasową, wskaż zmiennymi nową bazę danych, uruchom ponownie i przywróć kopię zapasową.

Więcej w wiki: Database.
