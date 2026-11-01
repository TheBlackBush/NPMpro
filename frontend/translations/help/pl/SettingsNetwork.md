## Sieć

Powiedz NPMpro, którym proxy przed nim można wierzyć w sprawie prawdziwego adresu klienta. Bez tego logi, listy dostępu i CrowdSec widzą adres proxy, a nie odwiedzającego.

Zmienna ustawiona w kontenerze ma pierwszeństwo przed interfejsem i blokuje pole (pole pokazuje znaczek z kłódką, taki jak "Ustawione przez TRUST_IP"). Używaj interfejsu dla wszystkiego, czego nie ustawiono w kontenerze.

- **Zaufane adresy IP proxy**: jeden adres IPv4 lub IPv6 albo zakres CIDR w wierszu, na przykład `10.0.0.0/8`, `192.168.1.5` lub `fd00::/8`. Żądania z tych adresów mogą przekazać prawdziwy adres IP klienta w `X-Forwarded-For`. Użyj dla load balancera lub tunelu bezpośrednio przed NPMpro. Domyślnie: puste (nikomu nie ufa się). Zmienna: `TRUST_IP` (oddzielona spacjami). Działa po przeładowaniu nginx, które wykonuje zapis.
- **Ufaj Cloudflare**: pobiera zakresy IP Cloudflare, regularnie je odświeża i im ufa, dzięki czemu nginx widzi prawdziwe adresy IP klientów za Cloudflare. Domyślnie: wyłączone. Zmienna: `TRUST_CLOUDFLARE`. Działa po przeładowaniu nginx, które wykonuje zapis. Najpierw przeczytaj uwagi o Cloudflare w wiki (Security): postawienie Cloudflare przed NPMpro ma koszty dla prywatności i bezpieczeństwa.

Ufaj tylko adresom, które kontrolujesz lub którym w pełni ufasz. Zaufany adres może podawać się za dowolnego odwiedzającego.

Jeśli zapis nie przejdzie testu nginx, nic nie jest zapisywane i pokazywany jest komunikat nginx.

Więcej w wiki: Security.
