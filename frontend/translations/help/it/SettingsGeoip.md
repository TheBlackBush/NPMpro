## GeoIP

NPMpro scarica da solo i database gratuiti MaxMind GeoLite2 e cerca paesi e reti sul tuo server, quindi gli IP dei visitatori non vengono mai inviati altrove. Non serve un container geoipupdate separato. I database alimentano la mappa e gli elenchi di Monitoraggio, GoAccess e le regole per paese di nginx.

Una variabile impostata sul container ha la precedenza sull'interfaccia e blocca il campo (il campo mostra "Impostato dall'ambiente"). Usa l'interfaccia per tutto ciò che non è impostato nel container. Il salvataggio avvia il download in background e lo stato qui sotto si aggiorna al termine.

### Account MaxMind

Ti servono un account MaxMind gratuito e una chiave di licenza (in MaxMind: Account, Manage license keys). Nella pagina c'è un link per registrarsi.

- **ID account**: variabile `GEOIP_ACCOUNT_ID`.
- **Chiave di licenza**: memorizzata cifrata e non più mostrata. Se la chiave salvata non può essere decifrata, inseriscila di nuovo. Variabile: `GEOIP_LICENSE_KEY`.

### Database

- **GeoLite2 Country**: paesi per la mappa, gli elenchi per paese e le regole per paese di nginx. Attivo per impostazione predefinita.
- **GeoLite2 ASN**: reti (numero e nome AS) per gli elenchi delle reti. Attivo per impostazione predefinita.
- **GeoLite2 City**: facoltativo, città per GoAccess. Un download molto più grande. Disattivato per impostazione predefinita.

Variabile: `GEOIP_EDITIONS`, separata da spazi, ad esempio `GeoLite2-Country GeoLite2-ASN`. Senza alcun database selezionato non viene scaricato né aggiornato nulla, e i database già scaricati vengono conservati.

### Stato

Mostra l'ultimo aggiornamento e l'ultimo errore. NPMpro aggiorna i database quando cambi l'account o i database, quando fai clic su **Aggiorna ora** e automaticamente ogni 3 giorni. Un aggiornamento automatico fallito viene ritentato dopo 24 ore. **Aggiorna ora** richiede un ID account e una chiave di licenza salvati.

Senza database, la mappa e gli elenchi per paese e per rete sono nascosti; il resto funziona.

Altro nel wiki: Monitoring.
