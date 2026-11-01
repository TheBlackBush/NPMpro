## Sieť

Povedzte NPMpro, ktorým proxy pred ním možno veriť pri skutočnej adrese klienta. Bez toho vidia logy, zoznamy prístupov a CrowdSec adresu proxy, nie návštevníka.

Premenná nastavená na kontajneri má prednosť pred používateľským rozhraním a zamkne pole (pole zobrazí odznak zámku, napríklad "Nastavené cez TRUST_IP"). Pre všetko, čo nie je nastavené v kontajneri, použite rozhranie.

- **Dôveryhodné IP proxy**: jedna adresa IPv4 alebo IPv6 či rozsah CIDR na riadok, napríklad `10.0.0.0/8`, `192.168.1.5` alebo `fd00::/8`. Požiadavky z týchto adries môžu odovzdať skutočnú IP klienta v `X-Forwarded-For`. Použite to pre load balancer alebo tunel priamo pred NPMpro. Predvolené: prázdne (nikomu sa neverí). Premenná: `TRUST_IP` (oddelená medzerami). Použije sa po reloade nginx, ktorý uloženie spustí.
- **Dôverovať Cloudflare**: stiahne rozsahy IP Cloudflare, pravidelne ich obnovuje a dôveruje im, takže nginx za Cloudflare vidí skutočné IP klientov. Predvolené: vypnuté. Premenná: `TRUST_CLOUDFLARE`. Použije sa po reloade nginx, ktorý uloženie spustí. Najprv si prečítajte poznámky o Cloudflare vo wiki (Security): Cloudflare pred NPMpro má náklady na súkromie a bezpečnosť.

Dôverujte len adresám, ktoré ovládate alebo im úplne veríte. Dôveryhodná adresa sa môže vydávať za ľubovoľného návštevníka.

Ak uloženie neprejde testom nginx, nič sa neuloží a zobrazí sa správa nginx.

Viac vo wiki: Security.
