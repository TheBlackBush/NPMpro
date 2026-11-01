## Ověřování

Přihlášení do webového rozhraní NPMpro přes poskytovatele OIDC (například Authentik, Keycloak nebo Google), vedle hesel nebo místo nich. Není to předávané ověřování: nechrání vaše proxy hostitele. K tomu viz Nastavení, Předávané ověřování.

Proměnná nastavená na kontejneru má přednost před rozhraním a zamkne pole (pole ukazuje "Nastaveno prostředím"). Pokud jsou všechny čtyři proměnné připojení nastaveny, OIDC je aktivní i bez zapnutí v rozhraní. Rozhraní používejte pro vše, co není nastaveno na kontejneru. Vše zde se použije po uložení.

### Poskytovatel

- **Zapnout přihlašování přes OIDC**: zobrazí tlačítko přihlášení na přihlašovací stránce.
- **URL vydavatele**: základní adresa discovery poskytovatele, například `https://accounts.example.com`. Proměnná: `OIDC_ISSUER_URL`.
- **ID klienta** a **Tajný klíč klienta**: od vašeho poskytovatele. Tajný klíč se ukládá zašifrovaný a už se nezobrazí; nechte prázdné pro zachování. Pokud změníte URL vydavatele nebo ID klienta, zadejte tajný klíč znovu. Proměnné: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Doména přesměrování**: doména, kterou lidé otevírají NPMpro, s portem, pokud není 443. Povinná, protože z ní vzniká callback URL. Proměnná: `OIDC_REDIRECT_DOMAIN`.
- **Callback URL**: jen pro čtení. Zaregistrujte ho u svého poskytovatele jako redirect URI.
- **Rozsahy (scopes)**: výchozí `openid email profile`. Změňte, pokud váš poskytovatel povoluje jen některé, například `openid email`.
- **Otestovat připojení**: zkontroluje, že NPMpro dosáhne na vydavatele.

### Přihlašovací tlačítko

Tlačítko na přihlašovací stránce: **Zobrazovaný název** (text za "Přihlásit se přes"), **Barva** (předvolba nebo vaše `#rrggbb`) a **Ikona** (vestavěná, nahraná jako PNG, JPEG, WebP nebo SVG do 256 KB, nebo stažená z URL). Zobrazí se náhled.

### Pravidla přihlášení

- **Vyžadovat ověřený e-mail**: odmítne uživatele, jejichž e-mail poskytovatel neověřil. Výchozí: zapnuto. Proměnná: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Přeskočit dvoufázové ověření po OIDC**: důvěřuje vlastní vícefaktorové kontrole poskytovatele. Výchozí: vypnuto. Proměnná: `OIDC_SKIP_MFA`.
- **Vypnout přihlašování heslem**: přihlásit se může jen OIDC. Zapnout to lze jen z relace přihlášené přes OIDC. Proměnná: `OIDC_DISABLE_PASSWORD`; pro obnovení přihlášení heslem ji nastavte na `false` a znovu vytvořte kontejner.

### Noví uživatelé

- **Vytvářet uživatele při prvním přihlášení** (výchozí: vypnuto): osoba bez účtu dostane účet s oprávněními uvedenými níže.
- **Povolené e-mailové domény**: oddělené čárkami; prázdné povolí jakoukoli doménu. S prázdným seznamem a bez vyžadovaného ověřeného e-mailu dostane účet každý, koho váš poskytovatel přijme.
- **Výchozí oprávnění nových uživatelů**: nastavují se pro každou sekci. Noví uživatelé nikdy nejsou správci.

Více ve wiki: Authentication.
