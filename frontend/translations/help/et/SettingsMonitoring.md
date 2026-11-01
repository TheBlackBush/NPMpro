## Logid ja jälgimine

Logifailid, GoAccessi logiraport ja liiklusstatistika, mis on Jälgimise lehe taga.

Konteineril määratud muutuja on UI-st tähtsam ja lukustab välja (väli näitab lukumärki, näiteks "Määratud muutujaga LOGROTATE", või statistika puhul "Määratud keskkonnaga"). Kõige jaoks, mida konteineris pole määratud, kasuta UI-d. Seaded, mis on märgitud "Restart required", salvestatakse kohe, aga loetakse konteineri käivitamisel; jaotis loetleb need siis all "Rakendamiseks taaskäivita konteiner".

### Logifailid

- **Kirjuta logifailid**: kirjutab nginxi error-, stream- ja access-logid kausta `/data/nginx/logs` ja roteerib neid iga päev. Vaikimisi: väljas. Muutuja: `LOGROTATE`. Rakendub pärast nginxi taaslaadimist, mille salvestamine käivitab. See jääb sisse, kuni GoAccess töötab.
- **Hoitavad logiroteerimised**: mitu roteeritud logifaili hoitakse, enne kui vanim kustutatakse, 1 kuni 1000. Vaikimisi: 3. Muutuja: `LOGROTATIONS`. Rakendub kohe.

### GoAccess

- **GoAccessi raport**: käivitab GoAccessi, administraatoritele mõeldud veebilogiraporti, veebiliidese aadressil `/goaccess`. Vaikimisi: väljas. Muutuja: `GOA`. Rakendub pärast konteineri taaskäivitamist. See ei lülita liiklusstatistikat sisse.

Kui raport on sees, näidatakse neid valikuid. Kõik rakenduvad pärast konteineri taaskäivitamist. Üks muutuja, `GOACLA`, asendab kõik need sinu enda GoAccessi valikutega ja lukustab need.

- **Hoia raporti andmeid**: 1 kuni 366 päeva. Vaikimisi: 30.
- **Anonüümi külastajate IP-d**: Väljas, Tase 1 (vaikimisi), Tase 2 (tugev) või Tase 3 (pedantne). Tase 1 peidab IPv4 viimase baidi (IPv6 viimased 64 bitti), tase 2 kaks baiti (80 bitti), tase 3 kolm baiti (96 bitti).
- **Eemalda päringustringid**: eemaldab raportis URL-idest päringustringid, nii et URL-ides olevaid tokeneid ei salvestata. Vaikimisi: sees.
- **Operatsioonisüsteemide täisversioonid**: näitab täisversiooni, mitte ainult perekonda. Vaikimisi: sees.
- **Lahenda hostinimed**: otsib külastajate IP-de hostinimesid. See saadab nende kohta DNS-päringuid. Vaikimisi: sees.

### Jälgimine

Need juhivad Jälgimise lehe Liiklus-vahekaarti. Kõik rakenduvad salvestamisel kohe. Muutujad: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Liiklusstatistika**: loeb nginxi access-logi ja loendab päringuid hosti, oleku, riigi ja võrgu kaupa. Vaikimisi: väljas. Väljalülitamine peatab uue loendamise; salvestatud statistika jääb alles, kuni see aegub, kui sa ei märgi dialoogis "Kustuta ka salvestatud statistika".
- **Hoia statistikat**: 7 kuni 365 päeva. Vaikimisi: 30. Minutipõhiseid andmeid hoitakse 24 tundi, tunnipõhiseid nii mitu päeva.
- **Kuva külastajate IP-d**: salvestab külastajate IP-d tunni kaupa, et loetleda enim esinevad IP-d. Vaikimisi: väljas, privaatsuse huvides. Väljalülitamine kustutab salvestatud IP-d.
- **Loenda unikaalseid külastajaid**: salvestab iga külastaja IP võtmega räsi hosti ja päeva kohta, et loendada unikaalseid külastajaid. Vaikimisi: väljas. Väljalülitamine kustutab räsid.
- **Külastajate piirang hosti ja päeva kohta**: 1000 kuni 1000000. Vaikimisi: 100000. Host, mis selle saavutab, lõpetab sel päeval uute külastajate loendamise ja näitab plussmärki.

Riigid ja võrgud vajavad GeoIP andmebaase (Seaded, GeoIP).

Rohkem wikis: Monitoring.
