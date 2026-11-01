## nginx

Ustawienia samego nginx, które dotyczą wszystkich hostów: ile workerów uruchamia, reguły TLS i opcjonalne moduły. Zapis testuje konfigurację i przeładowuje nginx. Konfiguracja, która nie przejdzie testu, nie jest stosowana.

Zmienna ustawiona w kontenerze ma pierwszeństwo przed interfejsem i blokuje pole (pole pokazuje znaczek z kłódką, taki jak "Ustawione przez NGINX_WORKER_PROCESSES"). Używaj interfejsu dla wszystkiego, czego nie ustawiono w kontenerze. Każde ustawienie tutaj działa po przeładowaniu nginx, które wykonuje zapis.

### Workery

- **Procesy workerów**: "Automatycznie (jeden na wątek CPU)" lub liczba do wątków CPU, które widzi kontener. Domyślnie: jeden na wątek, co najwyżej 4. Zmienna: `NGINX_WORKER_PROCESSES`.
- **Połączenia na workera**: otwarte połączenia, które każdy worker obsługuje jednocześnie, od 64 do 65535. Domyślnie: 512. Zmienna: `NGINX_WORKER_CONNECTIONS`.
- **Limit czasu zamykania workerów**: jak długo stare workery zachowują swoje połączenia po przeładowaniu. Wartość czasu nginx, taka jak `30s`, `10m` lub `1h`; `0` oznacza brak limitu. Domyślnie: `1h`. Zmienna: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Logowanie

- **Loguj błędy nieznalezionych plików**: zapisuje wiersz w logu błędów dla każdego żądania brakującego pliku. Domyślnie: wyłączone. Zmienna: `NGINX_LOG_NOT_FOUND`.

### TLS dla wszystkich hostów

Wyłączenie TLS 1.2 lub krzywych NIST P odcina starsze przeglądarki i klienty. TLS 1.3 jest zawsze włączony.

- **Zezwalaj na TLS 1.2**: domyślnie włączone. Zmienna: `NGINX_DISABLE_TLS12` (odwrócona: `true` wyłącza TLS 1.2).
- **Tylko postkwantowa wymiana kluczy**: dopuszcza tylko X25519MLKEM768, co wymaga nowego klienta. Wyłącza TLS 1.2 i krzywe NIST P i blokuje je, dopóki jest włączona. Domyślnie: wyłączone. Zmienna: `NGINX_FORCE_X25519MLKEM768`.
- **Zezwalaj na krzywe NIST P**: secp521r1, secp384r1 i prime256v1 do wymiany kluczy, obok X25519. Domyślnie: włączone. Zmienna: `NGINX_TRUST_SECPR1`.
- **Zezwalaj na podpisy RSA PKCS#1**: dla starych klientów, które nie mogą używać RSA-PSS. Domyślnie: wyłączone. Zmienna: `NGINX_TRUST_RSA_PKCS1`.

### Moduły

Wszystkie domyślnie wyłączone. Włącz moduł tylko wtedy, gdy potrzebuje go Twoja własna konfiguracja. Wyłączenie modułu, który własna konfiguracja nadal używa, powoduje niepowodzenie testu nginx.

- **njs (JavaScript)**: dyrektywy `js_*`. Zmienna: `NGINX_LOAD_NJS_MODULE`.
- **Uwierzytelnianie LDAP**: dyrektywy `auth_ldap`. Zmienna: `NGINX_LOAD_LDAP_MODULE`.
- **Upstreamy NTLM**: `ntlm` w blokach upstream. Zmienna: `NGINX_LOAD_NTLM_MODULE`.
- **Stan ruchu hostów wirtualnych**: dyrektywy `vhost_traffic_status_*`. Zmienna: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Więcej w wiki: Configuration.
