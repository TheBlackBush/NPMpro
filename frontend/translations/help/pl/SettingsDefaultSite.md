## Domyślna strona

Domyślna strona to to, co nginx odpowiada, gdy odwiedzający trafia do NPMpro z nazwą hosta, której nie używa żaden host, lub z adresem IP serwera. Tutaj wybierasz odpowiedź. Dotyczy wszystkich nieznanych nazw.

Zapis najpierw testuje nowy wybór w nginx. Jeśli test się nie powiedzie, nic nie jest zapisywane, poprzednia domyślna strona zostaje, a błąd nginx znajduje się w logu kontenera.

- **Strona gratulacyjna** (domyślnie): pokazuje stronę powitalną NPMpro.
- **Strona 404**: odpowiada stroną 404 Not Found.
- **Brak odpowiedzi (444)**: zamyka połączenie bez żadnej odpowiedzi. Użyj, aby skanery nic nie zobaczyły. Żądania HTTPS dla nieznanych nazw są odrzucane podczas uzgadniania TLS.
- **Przekierowanie**: kieruje odwiedzających pod inny adres tymczasowym przekierowaniem (302). Wpisz pełny adres URL `http://` lub `https://` bez spacji, cudzysłowów ani `; { } #`, do 255 znaków.
- **Własny HTML**: pokazuje Twoją własną stronę HTML. **Kod stanu HTTP** pod nim jest opcjonalny, od 400 do 599. Pozostaw puste dla 200 (OK).

Dla każdego wyboru poza Brak odpowiedzi żądania do nieznanych nazw przez zwykły HTTP są najpierw przekierowywane na HTTPS, a żądania HTTPS używają certyfikatu wybranego jako **Domyślny certyfikat** w Ustawienia, Certyfikaty i TLS.

Ta sekcja nie ma zmiennych środowiskowych, więc zmiana działa po zapisaniu.
