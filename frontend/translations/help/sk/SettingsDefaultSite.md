## Predvolená stránka

Predvolená stránka je to, čo nginx odpovie, keď návštevník príde na NPMpro s názvom hostiteľa, ktorý nepoužíva žiadny hostiteľ, alebo s IP adresou servera. Tu vyberiete odpoveď. Platí pre všetky neznáme mená.

Uloženie najprv otestuje novú voľbu v nginx. Ak test zlyhá, nič sa neuloží, zostane predchádzajúca predvolená stránka a chyba nginx je v logu kontajnera.

- **Gratulačná stránka** (predvolené): zobrazí uvítaciu stránku NPMpro.
- **Stránka 404**: odpovie stránkou 404 Not Found.
- **Bez odpovede (444)**: zatvorí spojenie bez akejkoľvek odpovede. Použite to, aby skenery nič nevideli. Požiadavky HTTPS na neznáme mená sa odmietnu počas TLS handshaku.
- **Presmerovanie**: pošle návštevníkov na inú adresu dočasným presmerovaním (302). Zadajte úplnú URL `http://` alebo `https://` bez medzier, úvodzoviek a znakov `; { } #`, najviac 255 znakov.
- **Vlastné HTML**: zobrazí vašu vlastnú stránku HTML. **Stavový kód HTTP** pod ním je voliteľný, od 400 do 599. Nechajte ho prázdny pre 200 (OK).

Pri každej voľbe okrem Bez odpovede sa požiadavky na neznáme mená cez obyčajné HTTP najprv presmerujú na HTTPS a požiadavky HTTPS používajú certifikát vybraný ako **Predvolený certifikát** v Nastavenia, Certifikáty a TLS.

Táto sekcia nemá žiadne premenné prostredia, takže sa zmena použije po uložení.
