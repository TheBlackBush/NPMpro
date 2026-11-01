## Pokročilé

Nastavenia, ktoré v drobnostiach menia správanie NPMpro.

Premenná nastavená na kontajneri má prednosť pred používateľským rozhraním a zamkne pole (pole zobrazí odznak zámku, napríklad "Nastavené cez TZ"). Pre všetko, čo nie je nastavené v kontajneri, použite rozhranie.

- **Časové pásmo**: časové pásmo kontajnera. Určuje časy v logoch, v reporte GoAccess a v plánovaných úlohách, ako sú plánované zálohy. Použite názov ako `Europe/Berlin`. Predvolené: `UTC`. Premenná: `TZ`. Použije sa po reštarte kontajnera: uloženie ho zapíše a sekcia ho uvedie pod "Na použitie reštartujte kontajner".
- **Formátovať konfigurácie nginx**: formátuje konfigurácie, ktoré NPMpro zapisuje, pomocou nginxbeautifier. Vypnite, ak zlyháva na neštandardných vlastných alebo pokročilých konfiguráciách. Predvolené: zapnuté. Premenná: `DISABLE_NGINX_BEAUTIFIER` (opačne: `true` formátovanie vypne). Použije sa okamžite.
- **Profilové obrázky Gravatar**: zobrazuje obrázok z Gravatar používateľom, ktorí nemajú nahraný avatar. Na získanie obrázka NPMpro posiela Gravatar hash e-mailovej adresy používateľa, preto to vypnite, ak vám to vadí. Predvolené: zapnuté. Premenná: `DISABLE_GRAVATAR` (opačne: `true` ho vypne). Použije sa okamžite; obrázok používateľa sa zmení pri jeho najbližšom uložení profilu a už získané obrázky zostanú dovtedy.
