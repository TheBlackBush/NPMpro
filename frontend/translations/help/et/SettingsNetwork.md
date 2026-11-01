## Võrk

Ütle NPMprole, millistel enda ees olevatel proksidel võib päris kliendiaadressi osas usaldada. Ilma selleta näevad logid, juurdepääsuloendid ja CrowdSec proksi aadressi, mitte külastaja oma.

Konteineril määratud muutuja on UI-st tähtsam ja lukustab välja (väli näitab lukumärki, näiteks "Määratud muutujaga TRUST_IP"). Kõige jaoks, mida konteineris pole määratud, kasuta UI-d.

- **Usaldatud proksi IP-d**: üks IPv4- või IPv6-aadress või CIDR-vahemik rea kohta, näiteks `10.0.0.0/8`, `192.168.1.5` või `fd00::/8`. Nendelt aadressidelt tulevad päringud võivad anda päris kliendi IP edasi päises `X-Forwarded-For`. Kasuta seda koormusjaoturi või tunneli jaoks otse NPMpro ees. Vaikimisi: tühi (kedagi ei usaldata). Muutuja: `TRUST_IP` (tühikuga eraldatud). Rakendub pärast nginxi taaslaadimist, mille salvestamine käivitab.
- **Usalda Cloudflare'i**: toob Cloudflare'i IP-vahemikud, värskendab neid regulaarselt ja usaldab neid, nii et nginx näeb Cloudflare'i taga päris kliendi IP-sid. Vaikimisi: väljas. Muutuja: `TRUST_CLOUDFLARE`. Rakendub pärast nginxi taaslaadimist, mille salvestamine käivitab. Loe esmalt wikist Cloudflare'i märkmeid (Security): Cloudflare'i panemisel NPMpro ette on privaatsuse ja turvalisuse hind.

Usalda ainult aadresse, mida sa kontrollid või täielikult usaldad. Usaldatud aadress võib esineda mis tahes külastajana.

Kui salvestamine ei läbi nginxi testi, ei salvestata midagi ja näidatakse nginxi teadet.

Rohkem wikis: Security.
