## Zaawansowane

Ustawienia, które w drobny sposób zmieniają zachowanie NPMpro.

Zmienna ustawiona w kontenerze ma pierwszeństwo przed interfejsem i blokuje pole (pole pokazuje znaczek z kłódką, taki jak "Ustawione przez TZ"). Używaj interfejsu dla wszystkiego, czego nie ustawiono w kontenerze.

- **Strefa czasowa**: strefa czasowa kontenera. Ustala czasy w logach, w raporcie GoAccess i w zaplanowanych zadaniach, takich jak zaplanowane kopie zapasowe. Użyj nazwy takiej jak `Europe/Berlin`. Domyślnie: `UTC`. Zmienna: `TZ`. Działa po ponownym uruchomieniu kontenera: zapis ją przechowuje, a sekcja wymienia ją pod "Uruchom ponownie kontener, aby zastosować".
- **Formatuj konfiguracje nginx**: formatuje konfiguracje zapisywane przez NPMpro za pomocą nginxbeautifier. Wyłącz, jeśli zawodzi na niestandardowych konfiguracjach własnych lub zaawansowanych. Domyślnie: włączone. Zmienna: `DISABLE_NGINX_BEAUTIFIER` (odwrócona: `true` wyłącza formatowanie). Działa od razu.
- **Zdjęcia profilowe Gravatar**: pokazuje obraz Gravatar użytkowników, którzy nie przesłali awatara. Aby pobrać obraz, NPMpro wysyła do Gravatar skrót adresu e-mail użytkownika, więc wyłącz to, jeśli ma to dla Ciebie znaczenie. Domyślnie: włączone. Zmienna: `DISABLE_GRAVATAR` (odwrócona: `true` wyłącza). Działa od razu; obraz użytkownika zmienia się przy jego następnym zapisie profilu, a już pobrane obrazy zostają do tego czasu.
