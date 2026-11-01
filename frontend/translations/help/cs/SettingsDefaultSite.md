## Výchozí stránka

Výchozí stránka je to, co nginx odpoví, když návštěvník přijde do NPMpro s názvem hostitele, který nepoužívá žádný hostitel, nebo s IP adresou serveru. Zde vyberete odpověď. Platí pro všechna neznámá jména.

Uložení nejdříve vyzkouší novou volbu v nginx. Pokud test selže, nic se neuloží, předchozí výchozí stránka zůstane a chyba nginx je v logu kontejneru.

- **Gratulační stránka** (výchozí): zobrazí uvítací stránku NPMpro.
- **Stránka 404**: odpoví stránkou 404 Not Found.
- **Bez odpovědi (444)**: ukončí spojení bez jakékoli odpovědi. Použijte, abyste skenerům nedali nic k vidění. Požadavky HTTPS na neznámá jména jsou odmítnuty během TLS handshaku.
- **Přesměrování**: pošle návštěvníky na jinou adresu dočasným přesměrováním (302). Zadejte úplnou URL `http://` nebo `https://` bez mezer, uvozovek nebo `; { } #`, nejvýše 255 znaků.
- **Vlastní HTML**: zobrazí vaši vlastní stránku HTML. **Stavový kód HTTP** pod ní je volitelný, od 400 do 599. Nechte prázdné pro 200 (OK).

U každé volby kromě Bez odpovědi se požadavky na neznámá jména přes prostý HTTP nejdříve přesměrují na HTTPS a požadavky HTTPS používají certifikát vybraný jako **Výchozí certifikát** v Nastavení, Certifikáty a TLS.

Tato sekce nemá žádné proměnné prostředí, takže se změna použije po uložení.
