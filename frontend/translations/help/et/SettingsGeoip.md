## GeoIP

NPMpro laadib tasuta MaxMind GeoLite2 andmebaasid ise alla ja otsib riike ja võrke sinu serveris, nii et külastajate IP-sid ei saadeta kuhugi. Eraldi geoipupdate konteinerit pole vaja. Andmebaasid toidavad Jälgimise kaarti ja loendeid, GoAccessit ja nginxi riigireegleid.

Konteineril määratud muutuja on UI-st tähtsam ja lukustab välja (väli näitab "Määratud keskkonnaga"). Kõige jaoks, mida konteineris pole määratud, kasuta UI-d. Salvestamine käivitab allalaadimise taustal ja allolev olek uueneb, kui see on valmis.

### MaxMindi konto

Vajad tasuta MaxMindi kontot ja litsentsivõtit (MaxMindis: Account, Manage license keys). Lehel on registreerumise link.

- **Konto ID**: muutuja `GEOIP_ACCOUNT_ID`.
- **Litsentsivõti**: salvestatakse krüptituna ja seda enam ei näidata. Kui salvestatud võtit ei saa dekrüptida, sisesta see uuesti. Muutuja: `GEOIP_LICENSE_KEY`.

### Andmebaasid

- **GeoLite2 Country**: riigid kaardi, riigiloendite ja nginxi riigireeglite jaoks. Vaikimisi sees.
- **GeoLite2 ASN**: võrgud (AS-number ja nimi) võrguloendite jaoks. Vaikimisi sees.
- **GeoLite2 City**: valikuline, linnad GoAccessi jaoks. Palju suurem allalaadimine. Vaikimisi väljas.

Muutuja: `GEOIP_EDITIONS`, tühikuga eraldatud, näiteks `GeoLite2-Country GeoLite2-ASN`. Kui ühtegi andmebaasi pole valitud, ei laadita ega uuendata midagi ja juba allalaaditud andmebaasid jäävad alles.

### Olek

Näitab viimast uuendust ja viimast viga. NPMpro uuendab andmebaase, kui muudad kontot või andmebaase, kui klõpsad **Uuenda kohe**, ja automaatselt iga 3 päeva järel. Ebaõnnestunud automaatset uuendust proovitakse uuesti 24 tunni pärast. **Uuenda kohe** vajab salvestatud konto ID-d ja litsentsivõtit.

Ilma andmebaasideta on kaart ning riigi- ja võrguloendid peidetud; ülejäänu töötab.

Rohkem wikis: Monitoring.
