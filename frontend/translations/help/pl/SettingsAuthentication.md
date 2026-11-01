## Uwierzytelnianie

Logowanie do interfejsu webowego NPMpro przez dostawcę OIDC (na przykład Authentik, Keycloak lub Google), obok haseł lub zamiast nich. To nie jest uwierzytelnianie przekazywane: nie chroni Twoich hostów proxy. Do tego zobacz Ustawienia, Uwierzytelnianie przekazywane.

Zmienna ustawiona w kontenerze ma pierwszeństwo przed interfejsem i blokuje pole (pole pokazuje "Ustawione przez środowisko"). Jeśli wszystkie cztery zmienne połączenia są ustawione, OIDC jest aktywne bez włączania go w interfejsie. Używaj interfejsu dla wszystkiego, czego nie ustawiono w kontenerze. Wszystko tutaj działa po zapisaniu.

### Dostawca

- **Włącz logowanie przez OIDC**: pokazuje przycisk logowania na stronie logowania.
- **URL wystawcy**: bazowy adres discovery dostawcy, na przykład `https://accounts.example.com`. Zmienna: `OIDC_ISSUER_URL`.
- **ID klienta** i **Sekret klienta**: od Twojego dostawcy. Sekret jest przechowywany zaszyfrowany i nigdy więcej nie jest pokazywany; pozostaw puste, aby go zachować. Jeśli zmienisz URL wystawcy lub ID klienta, wpisz sekret ponownie. Zmienne: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Domena przekierowania**: domena, której ludzie używają do otwarcia NPMpro, z portem, jeśli nie jest to 443. Wymagana, ponieważ buduje adres zwrotny. Zmienna: `OIDC_REDIRECT_DOMAIN`.
- **Callback URL**: tylko do odczytu. Zarejestruj go jako URI przekierowania u swojego dostawcy.
- **Zakresy (scopes)**: domyślnie `openid email profile`. Zmień, jeśli Twój dostawca dopuszcza tylko niektóre, na przykład `openid email`.
- **Testuj połączenie**: sprawdza, czy NPMpro może połączyć się z wystawcą.

### Przycisk logowania

Przycisk na stronie logowania: **Wyświetlana nazwa** (tekst po "Zaloguj się przez"), **Kolor** (gotowy wybór lub własny `#rrggbb`) i **Ikona** (wbudowana, przesłana jako PNG, JPEG, WebP lub SVG do 256 KB albo pobrana z adresu URL). Wyświetlany jest podgląd.

### Zasady logowania

- **Wymagaj zweryfikowanego adresu e-mail**: odrzuca użytkowników, których dostawca nie zweryfikował adresu e-mail. Domyślnie: włączone. Zmienna: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Pomiń weryfikację dwuetapową po OIDC**: ufa własnej weryfikacji wieloskładnikowej dostawcy. Domyślnie: wyłączone. Zmienna: `OIDC_SKIP_MFA`.
- **Wyłącz logowanie hasłem**: zalogować się może tylko OIDC. Możesz to włączyć tylko z sesji zalogowanej przez OIDC. Zmienna: `OIDC_DISABLE_PASSWORD`; aby przywrócić logowanie hasłem, ustaw ją na `false` i utwórz kontener ponownie.

### Nowi użytkownicy

- **Twórz użytkowników przy pierwszym logowaniu** (domyślnie: wyłączone): osoba bez konta dostaje konto z uprawnieniami poniżej.
- **Dozwolone domeny e-mail**: oddzielone przecinkami; puste dopuszcza dowolną domenę. Przy pustej liście i bez wymaganego zweryfikowanego e-maila konto dostaje każdy, kogo zaakceptuje Twój dostawca.
- **Domyślne uprawnienia nowych użytkowników**: ustawiane dla każdej sekcji. Nowi użytkownicy nigdy nie są administratorami.

Więcej w wiki: Authentication.
