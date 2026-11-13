## CrowdSec

Łączy wbudowanego w NPMpro bouncera CrowdSec z Twoim kontenerem CrowdSec. Każde żądanie do Twoich hostów jest sprawdzane na podstawie decyzji lokalnego API CrowdSec (LAPI) oraz, przy podanym adresie URL AppSec, na podstawie reguł AppSec. Zapis stosuje ustawienia od razu przez przeładowanie nginx; kontener nie jest restartowany.

NPMpro zapisuje `/data/crowdsec/crowdsec.conf` na podstawie tych ustawień. Ręczne zmiany tego pliku są nadpisywane. `ban.html` i `captcha.html` w tym samym folderze możesz edytować samodzielnie.

Zmienna ustawiona na kontenerze ma pierwszeństwo przed interfejsem i blokuje pole: `CROWDSEC_ENABLED`, `CROWDSEC_LAPI_URL`, `CROWDSEC_API_KEY`, `CROWDSEC_APPSEC_URL`.

### Stan i Testuj połączenie

Pokazuje, czy nginx ładuje bouncera i kiedy NPMpro ostatnio połączył się z LAPI. **Testuj połączenie** sprawdza wartości z formularza: jedno żądanie decyzji do LAPI z kluczem (lub certyfikatem klienta TLS) oraz, przy podanym adresie URL AppSec, jedno żądanie do AppSec. Puste pole klucza używa zapisanego klucza.

Zapis przy włączonym bouncerze najpierw uruchamia ten sam test. Gdy się nie powiedzie, pokazywane są przyczyny, a **Zapisz mimo to** zapisuje mimo wszystko, na przykład gdy CrowdSec jeszcze nie działa.

### Połączenie

- **Włącz bouncera**: sprawdza każde żądanie.
- **Adres URL LAPI**: na przykład `http://127.0.0.1:8080`.
- **Klucz API**: z `docker exec crowdsec cscli bouncers add npmpro`. Przechowywany w postaci zaszyfrowanej, nigdy więcej nie pokazywany. **Usuń zapisany klucz** go kasuje.
- **Certyfikat klienta TLS**: zamiast klucza plik certyfikatu i plik klucza w `/data/crowdsec/`; wymaga adresu URL LAPI z `https://`.
- **Weryfikuj certyfikaty TLS**: sprawdza certyfikat adresu URL LAPI lub AppSec z https.

### Blokowanie

- **Tryb**: live pyta LAPI o każdy adres IP klienta i buforuje odpowiedź przez podaną liczbę sekund; stream pobiera wszystkie decyzje w podanym odstępie.
- **Odpowiedź na bana**: strona bana (z opcjonalnym kodem statusu, domyślnie 403), przekierowanie albo kod statusu bez strony.
- **Środek zastępczy** i **Typy decyzji**: jak traktowane są decyzje, których bouncer nie może zastosować, i które typy są egzekwowane.
- **Wyłącz interfejs administracyjny spod kontroli CrowdSec**: żądania do interfejsu administracyjnego pomijają bouncera i AppSec. Włącz to przed użyciem AppSec z odrzuceniem, aby awaria CrowdSec nie zablokowała Ci dostępu.

### Captcha

Dostawca (reCAPTCHA, hCaptcha, Cloudflare Turnstile), jego klucz witryny i klucz tajny oraz czas ważności rozwiązanej captcha. Używane dla decyzji typu captcha.

### AppSec

- **Adres URL AppSec**: na przykład `http://127.0.0.1:7422`; puste wyłącza AppSec.
- **Gdy AppSec jest nieosiągalny**: odrzucenie blokuje każde sprawdzane żądanie, gdy AppSec jest niedostępny; przepuszczenie zostawia je bez sprawdzenia.

### Zaawansowane

Limit czasu żądań do LAPI, filtry scenariuszy, wykluczone ścieżki, żądania wewnętrzne, limity czasu i opcje AppSec oraz pliki stron bana i captcha z **Podglądem**.

### Zablokowany dostęp?

Uruchom CrowdSec ponownie albo ustaw `CROWDSEC_ENABLED=false` na kontenerze i utwórz go na nowo; potem popraw ustawienia tutaj.

Więcej w wiki: CrowdSec.
