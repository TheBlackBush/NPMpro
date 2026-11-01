## Síť

Řekněte NPMpro, kterým proxy před ním lze věřit, pokud jde o skutečnou adresu klienta. Bez toho logy, seznamy přístupů a CrowdSec vidí adresu proxy, ne návštěvníka.

Proměnná nastavená na kontejneru má přednost před rozhraním a zamkne pole (pole ukazuje odznak se zámkem, například "Nastaveno přes TRUST_IP"). Rozhraní používejte pro vše, co není nastaveno na kontejneru.

- **Důvěryhodné IP proxy**: jedna adresa IPv4 nebo IPv6 nebo rozsah CIDR na řádek, například `10.0.0.0/8`, `192.168.1.5` nebo `fd00::/8`. Požadavky z těchto adres mohou předat skutečnou IP klienta v `X-Forwarded-For`. Použijte pro load balancer nebo tunel přímo před NPMpro. Výchozí: prázdné (nikdo není důvěryhodný). Proměnná: `TRUST_IP` (oddělená mezerami). Použije se po reloadu nginx, který uložení provede.
- **Důvěřovat Cloudflare**: stáhne rozsahy IP Cloudflare, pravidelně je obnovuje a důvěřuje jim, takže nginx vidí skutečné IP klientů za Cloudflare. Výchozí: vypnuto. Proměnná: `TRUST_CLOUDFLARE`. Použije se po reloadu nginx, který uložení provede. Nejdříve si přečtěte poznámky o Cloudflare ve wiki (Security): umístění Cloudflare před NPMpro má dopady na soukromí a bezpečnost.

Důvěřujte jen adresám, které sami řídíte nebo kterým plně věříte. Důvěryhodná adresa se může vydávat za libovolného návštěvníka.

Pokud uložení neprojde testem nginx, nic se neuloží a zobrazí se zpráva nginx.

Více ve wiki: Security.
