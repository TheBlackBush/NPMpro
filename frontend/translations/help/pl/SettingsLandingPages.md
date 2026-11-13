## Strony docelowe

Strony, które odwiedzający widzą zamiast witryny: gdy dla adresu nic nie skonfigurowano, nie znaleziono strony, serwer za hostem nie odpowiada, lista dostępu ich odrzuca, host jest w konserwacji, brakuje certyfikatu albo CrowdSec ich blokuje lub sprawdza. Każda strona pojawia się w języku przeglądarki odwiedzającego, w jasnym i ciemnym motywie.

### Strona domyślna

Co pokazuje adres bez hosta: **Strona gratulacyjna**, **Strona 404**, **Brak odpowiedzi (444)**, **Przekierowanie** lub Twój własny **Własny HTML**.

### Strony globalne

Dla każdej strony: jej strona NPMpro (na przykład **Strona błędu 404** lub **Strona „Odmowa dostępu”**) albo **Własna strona**. Własna strona to jeden plik HTML (najwyżej 1 MB, UTF-8) ze stylami i obrazami w środku; wklej go lub użyj **Prześlij .html**. Może pokazywać IP odwiedzającego, czas, kod statusu i nazwę hosta za pomocą `<!--# echo var="remote_addr" -->`, `date_gmt`, `status` i `host`; inne dołączenia po stronie serwera są odrzucane.

Hosty proxy, hosty 404 i listy dostępu używają tych stron, chyba że wybiorą własne (karta **Strony** hosta proxy, pole **Strona** hosta 404, **Odmowa** listy dostępu).

**Podgląd** otwiera zapisaną stronę w nowej karcie z przykładowymi wartościami.

### CrowdSec

Ustawienia, CrowdSec decydują, czy blokada pokazuje stronę, przekierowuje, czy odpowiada tylko kodem statusu; ta sekcja decyduje, jak wyglądają strony blokady i captcha.
