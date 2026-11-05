## Logi

Zapis tego, kto co zmienił. Widzą go tylko administratorzy.

Każdy wpis pokazuje użytkownika, obiekt i akcję. Zapisywane są:

- **Utworzono**, **Zaktualizowano** i **Usunięto** dla hostów proxy, przekierowań, hostów 404, strumieni, list dostępu, certyfikatów, danych uwierzytelniających DNS, harmonogramów kopii zapasowych i użytkowników. Ustawienia zapisują tylko **Zaktualizowano**.
- **Włączono** i **Wyłączono** dla hostów proxy, przekierowań, hostów 404, strumieni i harmonogramów kopii zapasowych.
- Kopie zapasowe: **Utworzono**, **Przesłano**, **Usunięto**, **Przywrócono** i **Scalono** dla kopii zapasowej oraz **Kopia zapasowa wykonana** i **Kopia zapasowa nieudana** przy uruchomieniach zaplanowanych kopii.
- **Pobrano** dla certyfikatów. **Wyeksportowano** i **Zaimportowano** dla kopii jednej strony (hosty, listy dostępu, certyfikaty, dane uwierzytelniające DNS).
- Przenoszenie bazy danych: **Przeniesiono** i **Przeniesienie nieudane**.

Najnowsze wpisy są na górze. **Wczytaj więcej** pokazuje kolejne 50, a liczba pod listą mówi, ile z całości wczytano.

### Znajdowanie wpisu

- **Szukaj** przeszukuje szczegóły wszystkich wpisów, więc nazwa domeny lub adres email znajdzie powiązane wpisy.
- **Typ obiektu**, **Akcja** i **Użytkownik** zawężają listę. Można je łączyć ze sobą i z wyszukiwaniem.
- Przy aktywnym filtrze lub wyszukiwaniu lista podaje, ile wpisów pokazano. **Wyczyść filtry** usuwa je wszystkie.

### Szczegóły

Przycisk oka w wierszu (**Pokaż szczegóły**) otwiera wpis: użytkownika, co się stało i dane zapisane razem z nim. Przy zmianie jest to obiekt w takiej postaci, w jakiej został zapisany. Długie wartości są zawijane, a okno można przewijać.

Użytkownik usunięty później pojawia się jako **Usunięty użytkownik**. NPMpro nigdy sam nie usuwa wpisów, a logi nie wchodzą w skład kopii zapasowej.

Więcej w wiki: Usage (Audit Logs).
