## Pokročilé

Nastavení, která drobně mění chování NPMpro.

Proměnná nastavená na kontejneru má přednost před rozhraním a zamkne pole (pole ukazuje odznak se zámkem, například "Nastaveno přes TZ"). Rozhraní používejte pro vše, co není nastaveno na kontejneru.

- **Časové pásmo**: časové pásmo kontejneru. Určuje časy v lozích, v reportu GoAccess a v plánovaných úlohách, jako jsou plánované zálohy. Použijte název jako `Europe/Berlin`. Výchozí: `UTC`. Proměnná: `TZ`. Použije se po restartu kontejneru: uložení ji zapamatuje a sekce ji uvede pod "Pro použití restartujte kontejner".
- **Formátovat konfigurace nginx**: formátuje konfigurace, které NPMpro zapisuje, pomocí nginxbeautifier. Vypněte, pokud selhává u nestandardních vlastních nebo pokročilých konfigurací. Výchozí: zapnuto. Proměnná: `DISABLE_NGINX_BEAUTIFIER` (obrácená: `true` formátování vypne). Použije se okamžitě.
- **Profilové obrázky Gravatar**: zobrazuje obrázek z Gravataru u uživatelů, kteří nenahráli avatar. K získání obrázku NPMpro posílá Gravataru hash e-mailové adresy uživatele, proto vypněte, pokud vám to vadí. Výchozí: zapnuto. Proměnná: `DISABLE_GRAVATAR` (obrácená: `true` vypne). Použije se okamžitě; obrázek uživatele se změní při jeho dalším uložení profilu a již získané obrázky do té doby zůstanou.
