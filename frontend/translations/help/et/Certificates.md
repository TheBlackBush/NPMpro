## Sertifikaatide abi

### HTTP-sertifikaat

HTTP-ga kinnitatud sertifikaadi puhul üritavad Certboti serverid su domeenidele ligi saada HTTP kaudu (mitte HTTPS!) ja õnnestumise korral väljastavad sertifikaadi.

Selleks peab olema loodud puhverserver, mis on HTTP kaudu kättesaadav ja osutab sellele Nginxile. Kui sertifikaat on käes, võid puhverserveri panna HTTPS-i ka kasutama. Uuendamiseks peab HTTP-ligipääs siiski alles jääma.

Metamärgid (wildcard) selle meetodiga ei tööta.

### DNS-sertifikaat

DNS-iga kinnitatud sertifikaat vajab DNS-teenuse pakkuja pluginat. Plugin loob domeenile ajutised kirjed, Certbot kontrollib need üle ja õnnestumise korral väljastab sertifikaadi.

Puhverserverit enne taotlust looma ei pea. HTTP-ligipääsu ka ei nõuta.

See meetod toetab metamärke.

#### Salvestatud DNS-mandaadid

DNS-teenuse pakkuja ligipääsuandmed salvestatakse sertifikaadist eraldi, sertifikaatide lehe
vahekaardil _DNS-mandaadid_. Sertifikaat valib siis ainult ühe salvestatud
ligipääsuandmete komplekti, nii et mitu sertifikaati saavad neid jagada.

Saladused salvestatakse krüpteeritult ja neid ei näidata enam kunagi. Ligipääsuandmete muutmisel jäta
saladus tühjaks, et salvestatud väärtus alles jääks. Krüpteerimisvõti on fail
`/data/npmpro/dns-credentials.key`, varunda see koos andmebaasiga, muidu
ei saa salvestatud ligipääsuandmeid pärast taastamist lugeda.

Vormita teenusepakkujad kasutavad INI-tekstikasti, kuhu kleebid selle teenusepakkuja
ligipääsuandmete faili sisu.

### Kohandatud sertifikaat

Siia saad üles laadida oma TLS-sertifikaadi, mille on väljastanud sinu sertifitseerija.
