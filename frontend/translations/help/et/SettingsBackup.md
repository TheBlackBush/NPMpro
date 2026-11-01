## Varundamine ja taastamine

Salvesta oma hostid, sertifikaadid, kasutajad ja seaded `.npmpro` faili ning taasta need sellel või teisel NPMpro eksemplaril. Liiklusstatistika ja logid ei ole kunagi varukoopia osa.

### Loo varukoopia

- **Mida kaasata**: osad nagu hostid, juurdepääsuloendid, sertifikaadid, DNS-i volitused, kasutajad, seaded ja kohandatud failid. Alguses on kõik märgitud.
- **Kaasa saladused**: lisab privaatvõtmed, paroolid, kaheastmelise kinnitamise saladused, DNS-i volituste väärtused, OIDC kliendi saladuse ja GeoIP litsentsivõtme. Fail krüpteeritakse vähemalt 12 märgi pikkuse **Paroolfraasiga**, mille sisestad kaks korda. NPMpro ei salvesta seda, nii et ilma selleta ei saa varukoopiat taastada.
- Ilma saladusteta fail pole krüpteeritud ja jätab saladused välja. See sisaldab siiski hostinimesid, kasutajaid ja seadeid, nii et hoia see privaatsena.
- **Laadi alla** salvestab faili sinu arvutisse. **Hoia serveris** salvestab selle kausta `/data/backups`.

### Ajastatud varukoopiad

Lisa ajakavad, mis teevad varukoopiaid ise ja salvestavad need serverisse.

- **Millal**: iga N tunni järel, iga päev, nädal või kuu, konteineri ajavööndis.
- **Kaitse**: **Paroolfraas** (taastatav kõikjal), **Eksemplari võti** (pole midagi meelde jätta, taastatav ainult sellel eksemplaril) või **Ilma saladusteta**.
- **Hoia**: mitu selle ajakava faili hoitakse alles. Vanemad kustutatakse pärast iga edukat käivitust.
- Ajakava saab kohe käivitada, peatada, muuta või kustutada. Ebaõnnestunud käivitus on näha ajakava juures ja töölaual.

Ajastatud varukoopiad kaitsevad halbade muudatuste eest, mitte ketta kaotsimineku eest. Selleks kopeeri failid teisele masinale.

### Salvestatud varukoopiad

Loetleb serveris olevad failid. Laadi need alla, taasta või kustuta, või **Laadi varukoopia üles**. NPMpro teeb **Automaatne** varukoopia enne iga taastamist, ühendamist ja andmebaasi teisaldamist; see ei vaja paroolfraasi ja taastub ainult sellel eksemplaril.

### Taastamine

- **Asenda** vahetab valitud osad sellel eksemplaril välja varukoopia omade vastu. Sinu enda kontot ei asendata kunagi.
- **Ühenda** lisab varukoopia kirjed ega kustuta midagi. See näitab eelvaadet ja lubab iga konflikti puhul valida: jäta vahele, kasuta olemasolevat kirjet, lisa uuena või asenda.

Taastamine võetakse tagasi, kui nginx tulemuse tagasi lükkab. Uuema NPMpro versiooni varukoopiat ei saa taastada. Mõni taastatud seade vajab konteineri taaskäivitamist.

Sellel jaotisel pole keskkonnamuutujaid.

Rohkem wikis: Backup-and-restore.
