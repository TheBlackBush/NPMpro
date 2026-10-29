## Pomoc s certifikáty

### Certifikát HTTP

Certifikát ověřený prostřednictvím protokolu HTTP znamená, že servery Certbot se
pokusí připojit k vašim doménám přes protokol HTTP (nikoli HTTPS!) a v případě úspěchu
vydají váš certifikát.

Pro tuto metodu budete muset mít pro své domény vytvořeného _Proxy Host_, který
je přístupný přes HTTP a směruje na tuto instalaci Nginx. Po vydání certifikátu
můžete změnit _Proxy Host_ tak, aby tento certifikát používal i pro HTTPS
připojení. _Proxy Host_ však bude stále potřeba nakonfigurovat pro přístup přes HTTP,
aby se certifikát mohl obnovit.

Tento proces _nepodporuje_ domény se zástupnými znaky.

### Certifikát DNS

Certifikát ověřený DNS vyžaduje použití pluginu DNS Provider. Tento DNS
Provider se použije na vytvoření dočasných záznamů ve vaší doméně a poté Certbot
ověří tyto záznamy, aby se ujistil, že jste vlastníkem, a pokud bude úspěšný,
vydá váš certifikát.

Před požádáním o tento typ certifikátu není potřeba vytvořit _Proxy Host_.
Není také potřeba mít _Proxy Host_ nakonfigurovaný pro přístup HTTP.

Tento proces _podporuje_ domény se zástupnými znaky.

#### Uložené přihlašovací údaje DNS

Přihlašovací údaje pro vašeho DNS Providera se ukládají odděleně od certifikátu, na
kartě _Přihlašovací údaje DNS_ na stránce Certifikáty. Certifikát pak pouze vybere jeden
z uložených přihlašovacích údajů, takže je může sdílet více certifikátů.

Tajné hodnoty se ukládají šifrovaně a už se nikdy znovu nezobrazí. Při úpravě přihlašovacích údajů
ponechte tajnou hodnotu prázdnou, pokud chcete zachovat uloženou hodnotu. Klíč použitý k šifrování je soubor
`/data/npmpro/dns-credentials.key`, zálohujte ho společně s databází, jinak
uložené přihlašovací údaje nebude možné po obnovení přečíst.

Provideři bez formuláře používají textové pole INI, do kterého vložíte obsah
souboru s přihlašovacími údaji pro daného providera.

### Vlastní certifikát

Tuto možnost použijte na nahrání vlastního TLS certifikátu, který vám poskytla vaše
certifikační autorita.
