## Mis on juurdepääsuloend?

Juurdepääsuloend kaitseb proksihoste. See võib küsida külastajatelt kasutajanime ja parooli (Basic-autentimine), lubada või keelata külastajaid IP-aadressi järgi või teha mõlemat. See on kasulik teenustele, millel pole oma sisselogimist, või kui tahad tundmatud kliendid välja jätta.

Ühte loendit võivad kasutada paljud proksihostid ja asukohad.

### Üksikasjad

- **Nimi**: kohustuslik.
- **Piisab ühest tingimusest** (vaikimisi väljas): külastaja pääseb sisse, kui ta vastab ükskõik millisele ühele kontrollile, reeglile või kehtivale kasutajale. Väljas tähendab, et ta peab läbima mõlemad. See jätab ka selle hosti Auth Requesti vahele.
- **Edasta autentimine sihtserverile** (vaikimisi väljas): saadab külastaja `Authorization` päise edasi teenusele. Väljas hoiab sisselogimise NPMpro sees privaatsena.

### Autentimised

Lisa kasutajanimed ja paroolid. Kasutajanimed peavad loendis olema unikaalsed ega tohi sisaldada märki `:`. Loendit muutes jäta salvestatud parool tühjaks, kui tahad selle alles hoida.

### Reeglid

Reeglid lubavad või keelavad IP-aadressi, CIDR-vahemiku (`192.168.1.0/24`, `2001:db8::/32`) või väärtuse `unix:`. Neid rakendatakse sinu loetletud järjekorras ja esimene vaste võidab. Pane konkreetsed reeglid ette. Lõpetav `all` reegel sulgeb loendi, seatud lubama või keelama; see lisatakse ainult siis, kui on vähemalt üks muu reegel. Loend vajab vähemalt ühte kasutajat või ühte reeglit.

### Kasutamine proksihostidel

Proksihostil vali loend Üksikasjad-vahekaardil jaotises **Globaalsed juurdepääsuloendid**: **Avalikult ligipääsetav** (loendit pole) või **Kohandatud**. Kohandatud asukoht võib kasutada valikut **Globaalne** (hosti loendid), **Avalikult ligipääsetav** või oma **Kohandatud** loendeid.

Ühele hostile või asukohale saad lisada mitu loendit. Neid kontrollitakse ülalt alla, näidatud järjekorras, ja neid saab üles-alla liigutada. **Piisab ühest tingimusest** ja **Edasta autentimine sihtserverile** loevad ainult esimesel loendil. CrowdSeci puhul näevad blokeeritud IP-d blokeerimislehte enne paroolipäringut.

Rohkem wikis: Host options.
