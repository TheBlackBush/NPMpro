## Certyfikaty i TLS

Wartości domyślne dla certyfikatów, o które NPMpro prosi Twój serwer ACME (Let's Encrypt, chyba że ustawisz inny przez `ACME_SERVER`), dla sposobu ich staplingu i odnawiania oraz dla certyfikatu, który odpowiada dla nieznanych hostów. To jest sekcja Ustawień, a nie strona z listą Certyfikatów.

Zmienna ustawiona w kontenerze ma pierwszeństwo przed interfejsem i blokuje pole (pole pokazuje znaczek z kłódką, taki jak "Ustawione przez ACME_KEY_TYPE"). Niektóre pola zależą od innych: samotny `ACME_KEY_SIZE`, który jest krzywą ECDSA, utrzymuje typ klucza na ECDSA, a Must-Staple utrzymuje włączony OCSP stapling. Używaj interfejsu dla wszystkiego, czego nie ustawiono w kontenerze.

### Żądania certyfikatów

Działają od następnego żądania certyfikatu.

- **Typ klucza**: `ECDSA` (domyślnie, zalecane: mniejsze klucze, szybsze uzgadnianie) lub `RSA` dla klientów, które nie mogą używać ECDSA. Zmienna: `ACME_KEY_TYPE`.
- **Rozmiar klucza**: krzywa dla ECDSA (`secp256r1`, `secp384r1`, `secp521r1`; domyślnie `secp384r1`) lub liczba bitów dla RSA (`2048`, `3072`, `4096`; domyślnie `4096`). Zmienna: `ACME_KEY_SIZE`.
- **Profil ACME**: profil żądany od serwera, sprawdzany z serwerem przy zapisie. Puste używa wartości domyślnej serwera. W Let's Encrypt domyślny jest `shortlived`; klienci, którzy wymagają Common Name, nie działają z certyfikatami `shortlived` i `tlsserver`. Zmienna: `ACME_PROFILE` (`none` dla pustego).
- **OCSP Must-Staple**: oznacza nowe certyfikaty jako must-staple i utrzymuje włączony OCSP stapling. Tylko dla urzędów certyfikacji, które to obsługują (ZeroSSL); Let's Encrypt odrzuca takie żądania. Domyślnie: włączone dla Google Trust Services i ZeroSSL, w pozostałych przypadkach wyłączone. Zmienna: `ACME_MUST_STAPLE`.
- **Weryfikuj certyfikat serwera ACME**: domyślnie włączone. Wyłącz tylko dla prywatnego serwera ACME z certyfikatem samopodpisanym. Zmienna: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Oba działają po przeładowaniu nginx, które wykonuje zapis, i oba wyłączają kompresję certyfikatów TLS.

- **OCSP stapling dla certyfikatów ACME**: wysyła odpowiedź OCSP z certyfikatami z serwera ACME, gdy urząd certyfikacji oferuje OCSP. Domyślnie: włączone dla Google Trust Services i ZeroSSL, w pozostałych przypadkach wyłączone. Zmienna: `ACME_OCSP_STAPLING`.
- **OCSP stapling dla własnych certyfikatów**: to samo dla przesłanych certyfikatów. Domyślnie: wyłączone. Zmienna: `CUSTOM_OCSP_STAPLING`.

### Certyfikat domyślny

- **Certyfikat dla nieznanych hostów i interfejsu webowego**: serwowany dla nazw hostów, dla których NPMpro nie ma hosta, oraz na porcie interfejsu webowego. Domyślnie: wbudowany, wygenerowany certyfikat zastępczy. Zmienna: `DEFAULT_CERT_ID` (ID certyfikatu; `0` oznacza wbudowany). Działa po przeładowaniu nginx, które wykonuje zapis.

### Odnawianie

- **Interwał sprawdzania odnowień**: od 1 do 499 godzin między sprawdzeniami. Certyfikat jest odnawiany tylko wtedy, gdy nadejdzie na to czas. Domyślnie: 3. Zmienna: `CERTBOT_RUN_INTERVAL`. Działa od razu.

### ECH

- **Interwał rotacji kluczy ECH**: od 1 do 24 godzin między uruchomieniami Twojego skryptu ECH (`/data/tls/ech/cron.sh`). Używany tylko wtedy, gdy skrypt nie jest pusty. Domyślnie: 1. Zmienna: `ECH_ROTATION_INTERVAL`. Działa od razu.

Więcej w wiki: Security.
