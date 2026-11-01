## Čo je zoznam prístupov?

Zoznam prístupov chráni proxy hostiteľov. Môže od návštevníkov vyžadovať používateľské meno a heslo (Basic autentifikácia), povoliť alebo zamietnuť návštevníkov podľa IP adresy, alebo oboje. Hodí sa pre služby, ktoré nemajú vlastné prihlásenie, alebo ak chcete držať neznámych klientov mimo.

Jeden zoznam môže používať viac proxy hostiteľov a umiestnení.

### Podrobnosti

- **Názov**: povinné.
- **Splniť ktorékoľvek** (predvolene vypnuté): návštevník sa dostane dnu, ak spĺňa ktorúkoľvek jednu kontrolu, pravidlo alebo platného používateľa. Vypnuté znamená, že musí prejsť oboma. Zároveň preskočí Auth Request na tomto hostiteľovi.
- **Odoslať overenie na Upstream** (predvolene vypnuté): pošle hlavičku `Authorization` návštevníka ďalej službe. Vypnuté ponechá prihlásenie súkromné v rámci NPMpro.

### Autorizácie

Pridajte používateľské mená a heslá. Používateľské mená musia byť v zozname jedinečné a nesmú obsahovať `:`. Pri úprave zoznamu nechajte uložené heslo prázdne, ak ho chcete zachovať.

### Pravidlá

Pravidlá povoľujú alebo zamietajú IP adresu, rozsah CIDR (`192.168.1.0/24`, `2001:db8::/32`) alebo `unix:`. Uplatňujú sa v poradí, v akom ich uvediete, a vyhráva prvá zhoda. Konkrétne pravidlá dajte na začiatok. Záverečné pravidlo `all` zoznam uzatvára, nastavené na povoliť alebo zamietnuť; pridá sa len vtedy, keď je v zozname aspoň jedno ďalšie pravidlo. Zoznam potrebuje aspoň jedného používateľa alebo jedno pravidlo.

### Použitie pri proxy hostiteľoch

Pri proxy hostiteľovi vyberte zoznam v časti **Globálne zoznamy prístupov** na karte Podrobnosti: **Verejne prístupné** (bez zoznamu) alebo **Vlastný**. Vlastné umiestnenie môže použiť **Globálny** (zoznamy hostiteľa), **Verejne prístupné** alebo vlastné zoznamy **Vlastný**.

K jednému hostiteľovi alebo umiestneniu môžete pripojiť viac zoznamov. Kontrolujú sa zhora nadol v zobrazenom poradí a môžete ich posúvať hore a dole. **Splniť ktorékoľvek** a **Odoslať overenie na Upstream** sa počítajú len pri prvom zozname. S CrowdSec vidia zablokované IP stránku o zablokovaní skôr než výzvu na heslo.

Viac vo wiki: Host options.
