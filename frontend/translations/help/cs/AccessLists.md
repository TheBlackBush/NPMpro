## Co je seznam přístupů?

Seznam přístupů chrání proxy hostitele. Může od návštěvníků požadovat uživatelské jméno a heslo (ověření Basic), povolit nebo zakázat návštěvníky podle IP adresy, nebo obojí. Hodí se pro služby, které nemají vlastní přihlášení, nebo když chcete udržet venku neznámé klienty.

Jeden seznam může používat mnoho proxy hostitelů a umístění.

### Podrobnosti

- **Název**: povinný.
- **Splnit kterékoliv** (ve výchozím stavu vypnuto): návštěvník vstoupí, když splní kteroukoli jednu kontrolu, pravidlo nebo platného uživatele. Vypnuto znamená, že musí projít oběma. Také přeskočí Auth Request na tomto hostiteli.
- **Odeslat ověření na Upstream** (ve výchozím stavu vypnuto): předá hlavičku `Authorization` návštěvníka dál službě. Vypnuto nechává přihlášení soukromé pro NPMpro.

### Autorizace

Přidejte uživatelská jména a hesla. Uživatelská jména musí být v seznamu jedinečná a nesmí obsahovat `:`. Při úpravě seznamu nechte uložené heslo prázdné, pokud ho chcete zachovat.

### Pravidla

Pravidla povolují nebo zakazují IP adresu, rozsah CIDR (`192.168.1.0/24`, `2001:db8::/32`) nebo `unix:`. Uplatňují se v pořadí, v jakém je uvedete, a vyhrává první shoda. Konkrétní pravidla dejte na začátek. Závěrečné pravidlo `all` seznam uzavírá, nastavené na povolit nebo zakázat; přidá se jen tehdy, když existuje alespoň jedno další pravidlo. Seznam potřebuje alespoň jednoho uživatele nebo jedno pravidlo.

### Použití u proxy hostitelů

U proxy hostitele vyberte seznam v poli **Globální seznamy přístupů** na kartě Podrobnosti: **Veřejně přístupné** (bez seznamu) nebo **Vlastní**. Vlastní umístění může použít **Globální** (seznamy hostitele), **Veřejně přístupné** nebo vlastní seznamy **Vlastní**.

K jednomu hostiteli nebo umístění můžete připojit několik seznamů. Kontrolují se shora dolů, v zobrazeném pořadí, a můžete je přesouvat nahoru a dolů. **Splnit kterékoliv** a **Odeslat ověření na Upstream** se počítají jen u prvního seznamu. S CrowdSec vidí zablokované IP adresy stránku blokace dříve než výzvu k zadání hesla.

Více ve wiki: Host options.
