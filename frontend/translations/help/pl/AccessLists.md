## Czym jest lista dostępu?

Lista dostępu chroni hosty proxy. Może pytać odwiedzających o nazwę użytkownika i hasło (uwierzytelnianie Basic), zezwalać lub odmawiać dostępu według adresu IP albo robić jedno i drugie. Przydaje się dla usług, które nie mają własnego logowania, lub gdy chcesz trzymać z dala nieznanych klientów.

Jedna lista może być używana przez wiele hostów proxy i lokalizacji.

### Szczegóły

- **Nazwa**: wymagana.
- **Spełnij dowolny warunek** (domyślnie wyłączone): odwiedzający wchodzi, gdy spełni dowolną jedną kontrolę, regułę lub poprawnego użytkownika. Wyłączone oznacza, że musi przejść obie. Pomija też Auth Request na tym hoście.
- **Przekaż uwierzytelnienie do serwera docelowego** (domyślnie wyłączone): przekazuje nagłówek `Authorization` odwiedzającego do usługi. Wyłączone zachowuje logowanie wyłącznie w NPMpro.

### Autoryzacje

Dodaj nazwy użytkowników i hasła. Nazwy użytkowników muszą być unikalne w obrębie listy i nie mogą zawierać `:`. Podczas edycji listy pozostaw zapisane hasło puste, aby je zachować.

### Reguły

Reguły zezwalają lub odmawiają dostępu dla adresu IP, zakresu CIDR (`192.168.1.0/24`, `2001:db8::/32`) lub `unix:`. Są stosowane w kolejności, w jakiej je wypiszesz, a wygrywa pierwsza pasująca. Konkretne reguły umieść na początku. Końcowa reguła `all` zamyka listę, ustawiona na zezwalaj lub odmawiaj; jest dodawana tylko wtedy, gdy jest co najmniej jedna inna reguła. Lista wymaga co najmniej jednego użytkownika lub jednej reguły.

### Użycie w hostach proxy

W hoście proxy wybierz listę w polu **Globalne listy dostępu** na karcie Szczegóły: **Publicznie dostępne** (bez listy) lub **Własna**. Własna lokalizacja może używać **Globalna** (listy hosta), **Publicznie dostępne** lub własnych list **Własna**.

Do jednego hosta lub lokalizacji możesz dołączyć kilka list. Są sprawdzane od góry do dołu, w pokazanej kolejności, i możesz je przesuwać w górę i w dół. **Spełnij dowolny warunek** i **Przekaż uwierzytelnienie do serwera docelowego** liczą się tylko na pierwszej liście. Przy CrowdSec zablokowane adresy IP widzą stronę blokady przed monitem o hasło.

Więcej w wiki: Host options.

### Strona odmowy

**Odmowa** (401, 403) to to, co widzi odwiedzający, gdy lista go odrzuca (nie dotyczy hostów z uwierzytelnianiem przekazywanym): **Ustawienie globalne** (strona z Ustawienia, Strony docelowe), **Strona „Odmowa dostępu”**, **Własna strona** tylko dla tej listy (wklej lub prześlij jeden plik HTML) albo **Zwykła strona nginx**, która zachowuje stronę nginx.

### Kraje

Zezwalaj odwiedzającym lub blokuj ich według kraju. **Reguły krajów** to **Wyłączone**, **Zezwól tylko na te kraje** lub **Zablokuj te kraje**; kraje dodajesz przez **Dodaj kraj** (wyszukiwanie po nazwie kraju w języku interfejsu lub po dwuliterowym kodzie), a każdemu możesz nadać opcjonalny komentarz. Lista w trybie zezwalania lub blokowania wymaga co najmniej jednego kraju.

- **Blokuj odwiedzających o nieznanym kraju** dotyczy adresów publicznych, dla których baza GeoIP nie ma kraju. Tryb zezwalania blokuje je domyślnie, tryb blokowania je przepuszcza.
- **Zamknij połączenie bez odpowiedzi (444)** dotyczy tylko odwiedzających zablokowanych z powodu kraju. Odmowy według IP i hasła zachowują stronę odmowy.
- Adresy prywatne i lokalne zawsze przechodzą. Kraje są sprawdzane przed regułami IP i hasła, także przy opcji **Spełnij dowolny warunek**.
- Reguły krajów wymagają bazy krajów GeoIP (Ustawienia, GeoIP). Bez niej, lub gdy nginx odrzuca wiersz bazy, każdy odwiedzający przechodzi: zapisane kraje zostają, ale lista nie może dostać nowego trybu ani nowych krajów, dopóki baza nie będzie dostępna.
