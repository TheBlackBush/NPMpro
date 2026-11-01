## Czym jest Proxy Host?

Proxy Host to drzwi wejściowe usługi webowej. Odwiedzający otwierają Twoją domenę w NPMpro, a NPMpro przekazuje żądanie do usługi za nią. Może też dodać TLS (HTTPS) dla usług, które nie mają własnego. Proxy Hosty to najczęstsze zastosowanie NPMpro.

Użyj **Klonuj** w menu hosta, aby skopiować host do nowego okna dodawania. Kopia zaczyna bez nazw domen, ponieważ domena może należeć tylko do jednego włączonego hosta.

### Szczegóły

- **Nazwy domen**: nazwy, których używają odwiedzający. Wymagane. Dla nowego certyfikatu symbole wieloznaczne (`*.example.com`) wymagają wyzwania DNS.
- **Schemat**: jak NPMpro łączy się z usługą: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (serwuje pliki lub PHP z folderu) lub `empty` (bez upstreamu). Domyślnie `http://`. Zmiana schematu wyłącza opcje, które do niego nie pasują.
- **Docelowa nazwa hosta / IP / ścieżka**: adres usługi. Możesz dodać podścieżkę, na przykład `127.0.0.1/path`. Przy `path` wpisz zamiast tego folder. Zamontuj pliki w `/var/www`; tylko administratorzy mogą użyć folderu poza nim. Nazwa zaczynająca się od `cu_` wskazuje Twój własny blok upstream nginx (zobacz Load balancing w wiki).
- **Port docelowy**: opcjonalny. Przy `path` jest to wersja PHP.
- **Grupa**: dowolna etykieta, która utrzymuje porządek na długich listach.
- **Opcje** (wszystkie domyślnie wyłączone):
  - **Wysyłaj nagłówek noindex i blokuj niektóre boty (user agent)**: prosi wyszukiwarki o nieindeksowanie witryny i blokuje niektóre roboty.
  - **Wyłącz CrowdSec AppSec**: wyłącza CrowdSec AppSec tylko dla tego hosta. Działa tylko wtedy, gdy AppSec jest skonfigurowany.
  - **Wyłącz buforowanie żądań** i **Wyłącz buforowanie odpowiedzi**: dla upstreamów http i https. Pozostaw buforowanie włączone, chyba że przesyłasz strumieniowo lub wysyłasz duże pliki szybkim, stabilnym łączem. Wyłączenie buforowania żądań wyłącza też AppSec.
  - **Włącz kompresję przez upstream**: pozwala usłudze samej kompresować swoje odpowiedzi. Pozostaw wyłączone, chyba że usługa tego potrzebuje. Nie dla `path` i `empty`.
  - **Włącz fancyindex**: pokazuje listę plików, gdy folder nie ma pliku indeksu. Tylko dla `path`.
- **X-Frame-Options**: `SAMEORIGIN` (domyślnie), `DENY`, `none` (usuwa nagłówek) lub `upstream` (zachowuje to, co wysyła usługa).
- **Auth Request**: ustawia logowanie lub kontrolę botów przed hostem (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Domyślnie `none`. **Upstream Auth Request** jest opcjonalny; puste używa wartości domyślnej z Ustawienia, Uwierzytelnianie przekazywane.
- **Globalne listy dostępu**: **Publicznie dostępne** (domyślnie, bez logowania) lub **Własna**, jedna lub więcej list dostępu.

Websockety są zawsze włączone.

### Własne ustawienia lokalizacji

Lokalizacja kieruje jedną ścieżkę hosta (na przykład `/api/`) do innej usługi. Każda ma **Włączono**, ścieżkę z opcjonalnym typem dopasowania (`=`, `~`, `~*`, `^~` lub `@`), własny schemat, host, port, opcje, Auth Request i listy dostępu. Jej lista dostępu może być **Globalna**, co używa list hosta. Nie dziedziczy Auth Request hosta. Dodaj ukośnik na końcu ścieżki, chyba że chcesz dopasowania prefiksu. Administratorzy mogą dodać własną konfigurację nginx dla każdej lokalizacji przyciskiem z kołem zębatym.

### TLS

- **Certyfikat TLS**: Brak, Poproś o nowy certyfikat lub istniejący. Poniższe opcje wymagają certyfikatu.
- **Certyfikat mTLS**: urząd certyfikacji klientów. **mTLS opcjonalne** wpuszcza odwiedzających bez certyfikatu. **mTLS pomija Auth Request** pozwala odwiedzającym z ważnym certyfikatem pominąć Auth Request.
- **Wymuś HTTPS** przekierowuje HTTP na HTTPS. **Obsługa HTTP/3** włącza HTTP/3 (QUIC).
- **HSTS włączone (2 lata)**: wymaga Wymuś HTTPS. **HSTS dla subdomen + preload** wymaga HSTS.
- Dla nowego certyfikatu: **Użyj ponownie klucza (niezalecane)** i **Użyj wyzwania DNS**, z dostawcą, poświadczeniem i sekundami propagacji.

### Zaawansowane

Własna konfiguracja nginx dla całego hosta (blok server) i dla głównej lokalizacji `location /`. Tylko administratorzy mogą ją zmieniać.

Więcej w wiki: Host options.
