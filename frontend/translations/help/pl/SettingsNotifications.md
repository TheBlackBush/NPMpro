## Powiadomienia

NPMpro wysyła pocztę przez wybrany przez Ciebie serwer SMTP. Na razie poczta służy do wiadomości testowej, a później do resetowania haseł i alertów. Ustawienia tutaj mogą też pochodzić ze zmiennych kontenera: zmienna ustawiona na kontenerze ma pierwszeństwo przed interfejsem i blokuje swoje pole (pole pokazuje "Ustawione przez środowisko"). Używaj interfejsu dla wszystkiego, co nie jest ustawione w kontenerze.

### Serwer poczty

Każde połączenie jest sprawdzane jak inne żądania wychodzące: nazwa serwera musi się rozpoznawać, a adresy lokalne i link-local są odrzucane. Poczta jest uznawana za skonfigurowaną, gdy host i adres nadawcy są wypełnione.

- **Host** i **Port**: serwer SMTP. Zmienne: `SMTP_HOST`, `SMTP_PORT` (domyślnie 587).
- **Zabezpieczenia**: **STARTTLS** podnosi zwykłe połączenie do szyfrowanego (zwykle port 587), **TLS** jest szyfrowane od początku (zwykle port 465), **Brak** wysyła bez szyfrowania. Zmienna: `SMTP_SECURITY` (`starttls`, `tls` lub `none`).
- **Weryfikuj certyfikat**: odrzuca serwer z nieprawidłowym certyfikatem. Zmienna: `SMTP_VERIFY_TLS` (`false` wyłącza).
- **Użytkownik** i **Hasło**: logowanie. Hasło jest zapisywane w postaci zaszyfrowanej i nigdy więcej niepokazywane; **Usuń** je kasuje, a jeśli zapisanego nie da się odszyfrować, wpisz je ponownie. Zmienne: `SMTP_USERNAME`, `SMTP_PASSWORD`.
- **Nazwa nadawcy** i **Adres nadawcy**: jak wygląda poczta z NPMpro. Zmienne: `SMTP_FROM_NAME`, `SMTP_FROM`.
- **Adres do odpowiedzi**: dokąd trafiają odpowiedzi; puste używa adresu nadawcy. Zmienna: `SMTP_REPLY_TO`.

Przy zabezpieczeniach **Brak** i użytkowniku hasło byłoby przesyłane bez szyfrowania, więc jest to dozwolone tylko dla serwera w Twojej sieci lokalnej.

**Wyślij wiadomość testową** wysyła wiadomość z zapisanymi ustawieniami na wpisany adres (domyślnie Twój) i pokazuje odpowiedź serwera, jeśli się nie uda. Najpierw zapisz: przycisk jest wyłączony, dopóki formularz ma niezapisane zmiany, i ukryty, dopóki poczta nie jest skonfigurowana.

### Alerty e-mail

Widoczne po skonfigurowaniu serwera poczty. Wiadomości o problemach wykrytych przez NPMpro i o tym, kiedy zostały rozwiązane; problem, który pozostaje otwarty, jest powtarzany.

- **Wysyłaj do administratorów**: każdy włączony administrator z prawidłowym adresem otrzymuje alerty.
- **Wysyłaj także do**: więcej adresów, najwyżej 20, na przykład lista zespołu. Odrzucony adres jest oznaczony na swojej etykiecie. Zmienna: `ALERT_ADDRESSES` (oddzielone przecinkami).
- **Zdarzenia**: zaznacz problemy, o których chcesz dostawać wiadomości, pogrupowane według obszarów. Zaznaczenie zdarzenia obejmuje też jego rozwiązanie.
- **Przypominaj co (godzin)**: jak długo problem pozostaje cichy, zanim zostanie wysłany ponownie; 0 nigdy go nie powtarza, najwyżej 168.

**Wyślij przykład** od razu wysyła przykładowy alert, z zapisanymi ustawieniami, do wszystkich, którzy otrzymywaliby alerty. Najpierw zapisz: przycisk jest wyłączony, dopóki formularz ma niezapisane zmiany. Jeśli wysyłanie się nie powiedzie, komunikat wskazuje adres.

### Linki i język

- **Publiczny URL**: adres, pod którym osoby otwierają NPMpro, używany w linkach w wiadomościach, na przykład `https://npm.example.com`. Tylko HTTPS, bez ścieżki. **Użyj adresu tej przeglądarki** wypełnia go adresem tej strony, gdy jest otwarta przez HTTPS. Zmienna: `PUBLIC_URL`.
- **Domyślny język poczty**: język wiadomości dla osób, które żadnego nie wybrały. Język interfejsu każdego użytkownika jest zapamiętywany i używany w jego wiadomościach. Zmienna: `MAIL_LANGUAGE`.

Więcej w wiki: Configuration.
