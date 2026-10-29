## Pomoc dotycząca certyfikatów

### Certyfikat HTTP

Certyfikat weryfikowany przez HTTP oznacza, że serwery Certbot będą próbowały połączyć się z twoimi domenami przez HTTP (nie HTTPS!) i jeśli się to powiedzie, wydadzą twój certyfikat.

W przypadku tej metody musisz mieć utworzony Host proxy dla swoich domen, który jest dostępny przez HTTP i wskazuje na tę instalację Nginx. 
Po otrzymaniu certyfikatu możesz zmodyfikować Host proxy, aby używał również tego certyfikatu do połączeń HTTPS. Jednak Host proxy nadal będzie musiał być skonfigurowany do dostępu przez HTTP, aby certyfikat mógł być odnawiany.

Ten proces nie obsługuje domen wieloznacznych (wildcard).

### Certyfikat DNS

Certyfikat weryfikowany przez DNS wymaga użycia wtyczki dostawcy DNS. Ten dostawca DNS zostanie użyty do utworzenia tymczasowych rekordów w twojej domenie, a następnie Certbot sprawdzi te rekordy, aby upewnić się, że jesteś właścicielem i jeśli się powiedzie, wydadzą twój certyfikat.

Nie musisz mieć utworzonego Hosta proxy przed wystąpieniem o ten typ certyfikatu. Nie musisz również mieć skonfigurowanego Hosta proxy do dostępu przez HTTP.

Ten proces obsługuje domeny wieloznaczne (wildcard).

#### Zapisane dane uwierzytelniające DNS

Dane uwierzytelniające dostawcy DNS są zapisywane oddzielnie od certyfikatu, na karcie
_Dane uwierzytelniające DNS_ na stronie Certyfikaty. Certyfikat wybiera potem tylko jeden z
zapisanych zestawów danych, dzięki czemu kilka certyfikatów może z nich korzystać wspólnie.

Sekrety są przechowywane w postaci zaszyfrowanej i nigdy nie są ponownie wyświetlane. Podczas edycji danych uwierzytelniających
pozostaw sekret pusty, aby zachować zapisaną wartość. Klucz używany do szyfrowania to plik
`/data/npmpro/dns-credentials.key`. Twórz jego kopię zapasową razem z bazą danych, w przeciwnym razie
po przywróceniu zapisanych danych uwierzytelniających nie będzie można odczytać.

Dostawcy bez formularza używają pola tekstowego INI, do którego wklejasz zawartość
pliku z danymi uwierzytelniającymi tego dostawcy.

### Własny certyfikat

Użyj tej opcji, aby przesłać własny certyfikat TLS, dostarczony przez twój własny urząd certyfikacji.
