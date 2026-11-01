## Czym jest Redirection Host?

Redirection Host kieruje odwiedzających jednej domeny pod inny adres. Użyj go, gdy witryna zmienia domenę, a stare linki mają nadal działać, lub aby przekierować `www` na główną nazwę.

Użyj **Klonuj** w menu hosta, aby skopiować host do nowego okna dodawania. Kopia zaczyna bez nazw domen, ponieważ domena może należeć tylko do jednego włączonego hosta.

### Szczegóły

- **Nazwy domen**: nazwy, które są przekierowywane. Wymagane. Symbole wieloznaczne są dozwolone dla nowego certyfikatu tylko z wyzwaniem DNS.
- **Schemat**: schemat celu. "zachowaj (jak w żądaniu)" jest wartością domyślną i zachowuje `http` lub `https` z wizyty. Albo wybierz `http` lub `https`.
- **Domena docelowa**: domena, do której kierowani są odwiedzający, na przykład `example.com`. Wymagana.
- **Kod HTTP**: kod odpowiedzi. Domyślnie 301 Moved permanently. Inne opcje: 302 Moved temporarily, 303 See other, 307 Temporary redirect i 308 Permanent redirect. Użyj 301 lub 308, gdy przeniesienie jest na stałe; przeglądarki i wyszukiwarki je zapamiętują.
- **Grupa**: dowolna etykieta, która utrzymuje porządek na długich listach. Wybierz używaną lub wpisz nową nazwę.
- **Zachowaj ścieżkę** (domyślnie wyłączone): dodaje do celu oryginalną ścieżkę i zapytanie. Po włączeniu `old.example/a?b=1` trafia na `new.example/a?b=1`. Bez tego każdy odwiedzający ląduje na początku celu.

### TLS

- **Certyfikat TLS**: Brak, Poproś o nowy certyfikat lub istniejący. Poniższe opcje wymagają certyfikatu.
- **Certyfikat mTLS**: urząd certyfikacji klientów. **mTLS opcjonalne** wpuszcza odwiedzających bez certyfikatu klienta.
- **Wymuś HTTPS**: najpierw przekierowuje HTTP na HTTPS.
- **Obsługa HTTP/3**: włącza HTTP/3 (QUIC).
- **HSTS włączone (2 lata)**: wymaga Wymuś HTTPS. **HSTS dla subdomen + preload** wymaga HSTS.
- Dla nowego certyfikatu: **Użyj ponownie klucza (niezalecane)** i **Użyj wyzwania DNS**, z dostawcą, poświadczeniem i sekundami propagacji.

Wszystkie opcje TLS są domyślnie wyłączone.

### Zaawansowane

Własna konfiguracja nginx dodawana wewnątrz bloku server hosta. Tylko administratorzy mogą ją zmieniać; inni użytkownicy widzą ją tylko do odczytu.

Więcej w wiki: Host options.
