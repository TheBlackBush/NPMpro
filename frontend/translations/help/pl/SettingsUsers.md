## Użytkownicy

Osoby, które mogą logować się do tego NPMpro. Tę listę widzą tylko administratorzy. Można też logować się przez dostawcę OIDC, skonfigurowanego w Ustawienia, Uwierzytelnianie.

Lista pokazuje imię i nazwisko, adres email, role i stan każdego użytkownika. Szukaj po nazwie lub adresie email i sortuj według kolumny.

### Dodawanie i edycja użytkownika

**Nowy użytkownik** prosi o **Imię / Nazwisko** i **Adres email**. Edytuj otwiera to samo okno, w którym możesz też wgrać lub usunąć awatar użytkownika. W sekcji **Opcje**:

- **Administrator**: pełny dostęp, także do Ustawień, Użytkowników i Logów. Bez tej opcji użytkownik jest Standardowym użytkownikiem, ograniczonym uprawnieniami poniżej.
- **Wyłączone**: użytkownik nie może się już logować, a jego otwarte sesje się kończą.

Nie możesz zmienić własnych ról, wyłączyć ani usunąć siebie, a Twój własny wiersz oferuje tylko Edytuj.

### Menu wiersza

Dla pozostałych kont:

- **Uprawnienia**: patrz niżej.
- **Ustaw hasło**: ustawia nowe hasło. Wszystkie pozostałe urządzenia tego użytkownika zostają wylogowane.
- **Resetuj MFA**: tylko dla użytkowników z MFA. Wyłącza MFA bez kodu odzyskiwania, a użytkownik może skonfigurować je ponownie.
- **Unieważnij sesje**: wylogowuje użytkownika na wszystkich urządzeniach.
- **Wyłącz** lub **Włącz**: to samo co opcja **Wyłączone**.
- **Usuń**: usuwa konto. Jego wpisy w Logach pozostają.

### Uprawnienia

Dla Standardowego użytkownika wybierz dla każdej sekcji (Proxy, Przekierowania, 404, Strumienie, Listy dostępu, Certyfikaty): **Zarządzaj**, **Tylko podgląd** lub **Ukryte**. **Widoczność elementów** określa, czy użytkownik widzi **Wszystkie elementy**, czy **Tylko utworzone elementy**.

Wybór włącza też to, czego sekcja potrzebuje: Proxy potrzebują Listy dostępu i Certyfikatów, a Ukryte jest niedostępne, dopóki inna sekcja tego potrzebuje. Administratorzy mają dostęp do wszystkiego, więc dla nich dostępna jest tylko widoczność elementów.

Więcej w wiki: Usage (Users and permissions) i Authentication.
