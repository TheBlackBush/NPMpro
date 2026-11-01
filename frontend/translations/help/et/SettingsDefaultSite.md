## Vaikesait

Vaikesait on see, mida nginx vastab, kui külastaja jõuab NPMpro juurde hostinimega, mida ükski host ei kasuta, või serveri IP-aadressiga. Vali siin vastus. See kehtib kõigile tundmatutele nimedele.

Salvestamine testib uut valikut esmalt nginxiga. Kui test ebaõnnestub, ei salvestata midagi, eelmine vaikesait jääb ja nginxi viga on konteineri logis.

- **Õnnitlusleht** (vaikimisi): näitab NPMpro tervituslehte.
- **404 leht**: vastab 404 Not Found lehega.
- **Vastuseta (444)**: sulgeb ühenduse ilma igasuguse vastuseta. Kasuta seda, et skannerid ei näeks midagi. HTTPS-päringud tundmatutele nimedele lükatakse tagasi TLS-i kätluse ajal.
- **Ümbersuunamine**: saadab külastajad ajutise ümbersuunamisega (302) teisele aadressile. Sisesta täielik `http://` või `https://` URL ilma tühikute, jutumärkide ja märkideta `; { } #`, kuni 255 märki.
- **Kohandatud HTML**: näitab sinu enda HTML-lehte. Selle all olev **HTTP olekukood** on valikuline, vahemikus 400 kuni 599. Jäta tühjaks, et saada 200 (OK).

Iga valiku puhul peale Vastuseta suunatakse tavalise HTTP-ga tehtud päringud tundmatutele nimedele esmalt HTTPS-ile ja HTTPS-päringud kasutavad sertifikaati, mis on valitud **Vaikesertifikaadiks** jaotises Seaded, Sertifikaadid ja TLS.

Sellel jaotisel pole keskkonnamuutujaid, nii et muudatus rakendub salvestamisel.
