## Täpsemad

Seaded, mis muudavad NPMpro käitumist väikestes asjades.

Konteineril määratud muutuja on UI-st tähtsam ja lukustab välja (väli näitab lukumärki, näiteks "Määratud muutujaga TZ"). Kõige jaoks, mida konteineris pole määratud, kasuta UI-d.

- **Ajavöönd**: konteineri ajavöönd. See määrab ajad logides, GoAccessi raportis ja ajastatud töödes, näiteks ajastatud varukoopiates. Kasuta nime nagu `Europe/Berlin`. Vaikimisi: `UTC`. Muutuja: `TZ`. Rakendub pärast konteineri taaskäivitamist: salvestamine jätab selle meelde ja jaotis loetleb selle all "Rakendamiseks taaskäivita konteiner".
- **Vorminda nginxi konfiguratsioonid**: vormindab NPMpro kirjutatud konfiguratsioonid nginxbeautifieriga. Lülita välja, kui see ebaõnnestub mittestandardsetel kohandatud või täpsematel konfiguratsioonidel. Vaikimisi: sees. Muutuja: `DISABLE_NGINX_BEAUTIFIER` (pööratud: `true` lülitab vormindamise välja). Rakendub kohe.
- **Gravatari profiilipildid**: näitab Gravatari pilti kasutajatele, kellel pole üleslaaditud avatari. Pildi toomiseks saadab NPMpro Gravatarile kasutaja e-posti aadressi räsi, nii et lülita välja, kui see sulle korda läheb. Vaikimisi: sees. Muutuja: `DISABLE_GRAVATAR` (pööratud: `true` lülitab välja). Rakendub kohe; kasutaja pilt muutub tema järgmisel profiili salvestamisel ja juba toodud pildid jäävad selle ajani.
