## Uwierzytelnianie przekazywane

Uwierzytelnianie przekazywane stawia logowanie lub kontrolę botów przed hostem proxy. Dla każdego żądania nginx najpierw pyta usługę uwierzytelniania, czy odwiedzający może przejść. NPMpro ma to wbudowane dla Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia i Authentik. Dostawcę uruchamiasz we własnym kontenerze.

Ta strona ustawia domyślny adres (upstream) każdego dostawcy. Host proxy włącza kontrolę przez **Auth Request** w Opcjach na karcie Szczegóły (lub we własnej lokalizacji).

Zmienna ustawiona w kontenerze ma pierwszeństwo przed interfejsem i blokuje pole (pole pokazuje znaczek z kłódką, taki jak "Ustawione przez AUTH_REQUEST_AUTHELIA_UPSTREAM"). Używaj interfejsu dla wszystkiego, czego nie ustawiono w kontenerze. Każde ustawienie tutaj działa po przeładowaniu nginx, które wykonuje zapis. Jeśli test nginx się nie powiedzie, nic nie jest zapisywane.

### Domyślne upstreamy

- **Upstream Anubis**, **Upstream Tinyauth**, **Upstream OAuth2 Proxy**, **Upstream VoidAuth**, **Upstream Authelia**, **Upstream Authentik**: używane przez hosty proxy z tym dostawcą, które nie mają własnego upstreamu. Wartość samego hosta wygrywa. Domyślnie: puste (brak). Zmienne: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Format: `scheme://host:port`, na przykład `http://127.0.0.1:9091`, lub `scheme://cu_name` dla własnego bloku upstream nginx, którego nazwa zaczyna się od `cu_`. Użyj `http` lub `https`; port jest wymagany; adres IPv6 trafia w nawiasy kwadratowe. Bez ścieżki, bez spacji i bez żadnego z `; { } # " ' $ \`.

Nie możesz opróżnić wartości domyślnej, dopóki hosty proxy używają tego dostawcy bez własnego upstreamu. Komunikat wymienia te hosty.

Host, który używa dostawcy bez upstreamu w żadnym miejscu, dostaje "Błąd konfiguracji".

### Anubis

- **Własne obrazy Anubis**: pokazuje Twoje `happy.webp`, `reject.webp` i `pensive.webp` na stronach wyzwań Anubis. Domyślnie: włączone, gdy wszystkie trzy pliki istnieją i nie są puste, w przeciwnym razie wyłączone. Zmienna: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. Obrazy trafiają do `public/anubis` w Twoim folderze danych.

Więcej w wiki: Forward-Authentication.
