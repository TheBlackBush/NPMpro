## Overovanie

Prihlasovanie do webového rozhrania NPMpro cez poskytovateľa OIDC (napríklad Authentik, Keycloak alebo Google), popri heslách alebo namiesto nich. Nejde o preposielané overovanie: neochraňuje vašich proxy hostiteľov. Na to pozrite Nastavenia, Preposielané overovanie.

Premenná nastavená na kontajneri má prednosť pred používateľským rozhraním a zamkne pole (pole zobrazí "Nastavené prostredím"). Ak sú nastavené všetky štyri premenné pripojenia, OIDC je aktívne aj bez zapnutia v rozhraní. Pre všetko, čo nie je nastavené v kontajneri, použite rozhranie. Všetko tu sa použije po uložení.

### Poskytovateľ

- **Zapnúť prihlasovanie cez OIDC**: zobrazí tlačidlo prihlásenia na prihlasovacej stránke.
- **URL vydavateľa**: základná adresa discovery poskytovateľa, napríklad `https://accounts.example.com`. Premenná: `OIDC_ISSUER_URL`.
- **ID klienta** a **Tajný kľúč klienta**: od vášho poskytovateľa. Tajný kľúč sa ukladá zašifrovaný a už sa nezobrazí; ak ho chcete zachovať, nechajte pole prázdne. Ak zmeníte URL vydavateľa alebo ID klienta, zadajte tajný kľúč znova. Premenné: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Doména presmerovania**: doména, ktorú ľudia používajú na otvorenie NPMpro, s portom, ak nie je 443. Povinné, pretože z nej vzniká callback URL. Premenná: `OIDC_REDIRECT_DOMAIN`.
- **Callback URL**: len na čítanie. Zaregistrujte ju u poskytovateľa ako redirect URI.
- **Rozsahy (scopes)**: predvolene `openid email profile`. Zmeňte, ak váš poskytovateľ povoľuje len niektoré, napríklad `openid email`.
- **Otestovať pripojenie**: skontroluje, či NPMpro dosiahne vydavateľa.

### Prihlasovacie tlačidlo

Tlačidlo na prihlasovacej stránke: **Zobrazovaný názov** (text za "Prihlásiť sa cez"), **Farba** (predvoľba alebo vaše vlastné `#rrggbb`) a **Ikona** (vstavaná, nahraná ako PNG, JPEG, WebP alebo SVG do 256 KB, alebo stiahnutá z URL). Zobrazí sa náhľad.

### Pravidlá prihlásenia

- **Vyžadovať overený e-mail**: odmietne používateľov, ktorých poskytovateľ neoveril e-mail. Predvolené: zapnuté. Premenná: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Preskočiť dvojfaktorové overenie po OIDC**: dôveruje vlastnej viacfaktorovej kontrole poskytovateľa. Predvolené: vypnuté. Premenná: `OIDC_SKIP_MFA`.
- **Vypnúť prihlasovanie heslom**: prihlásiť sa dá len cez OIDC. Zapnúť to môžete len z relácie, ktorá sa prihlásila cez OIDC. Premenná: `OIDC_DISABLE_PASSWORD`; na obnovenie prihlasovania heslom ju nastavte na `false` a znova vytvorte kontajner.

### Noví používatelia

- **Vytvárať používateľov pri prvom prihlásení** (predvolene vypnuté): osoba bez účtu ho dostane s oprávneniami uvedenými nižšie.
- **Povolené e-mailové domény**: oddelené čiarkou; prázdne povoľuje ľubovoľnú doménu. Pri prázdnom zozname a nevyžadovanom overenom e-maile dostane účet každý, koho váš poskytovateľ prijme.
- **Predvolené oprávnenia nových používateľov**: nastavujú sa pre každú sekciu. Noví používatelia nikdy nie sú správcovia.

Viac vo wiki: Authentication.
