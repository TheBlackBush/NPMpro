## Log e monitoraggio

File di log, report di log GoAccess e statistiche del traffico alla base della pagina Monitoraggio.

Una variabile impostata sul container ha la precedenza sull'interfaccia e blocca il campo (il campo mostra un badge con il lucchetto, ad esempio "Impostato da LOGROTATE", oppure "Impostato dall'ambiente" per le statistiche). Usa l'interfaccia per tutto ciò che non è impostato nel container. Le impostazioni contrassegnate "Riavvio necessario" vengono salvate subito ma lette all'avvio del container; la sezione le elenca poi sotto "Riavvia il container per applicare".

### File di log

- **Scrivi file di log**: scrive i log di errore, stream e accesso di nginx in `/data/nginx/logs` e li ruota ogni giorno. Predefinito: disattivato. Variabile: `LOGROTATE`. Si applica dopo il reload di nginx eseguito dal salvataggio. Resta attivo finché GoAccess è in esecuzione.
- **Rotazioni dei log conservate**: quanti file di log ruotati vengono conservati prima che il più vecchio sia eliminato, da 1 a 1000. Predefinito: 3. Variabile: `LOGROTATIONS`. Si applica subito.

### GoAccess

- **Report GoAccess**: esegue GoAccess, un report dei log web per amministratori, sotto `/goaccess` dell'interfaccia web. Predefinito: disattivato. Variabile: `GOA`. Si applica dopo il riavvio del container. Non attiva le statistiche del traffico.

Con il report attivo compaiono queste opzioni. Tutte si applicano dopo il riavvio del container. Una sola variabile, `GOACLA`, le sostituisce tutte con le tue opzioni di GoAccess e le blocca.

- **Conserva i dati del report**: da 1 a 366 giorni. Predefinito: 30.
- **Anonimizza gli IP dei visitatori**: Off, Level 1 (predefinito), Level 2 (strong) o Level 3 (pedantic). Il livello 1 nasconde l'ultimo byte IPv4 (gli ultimi 64 bit di IPv6), il livello 2 due byte (80 bit), il livello 3 tre byte (96 bit).
- **Rimuovi le query string**: rimuove le query string dagli URL nel report, così i token negli URL non vengono memorizzati. Predefinito: attivo.
- **Versioni complete del sistema operativo**: mostra la versione completa, non solo la famiglia. Predefinito: attivo.
- **Risolvi i nomi host**: cerca i nomi host degli IP dei visitatori. Questo invia query DNS per essi. Predefinito: attivo.

### Monitoraggio

Controllano la scheda Traffico della pagina Monitoraggio. Tutte si applicano subito al salvataggio. Variabili: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Statistiche del traffico**: legge il log di accesso di nginx e conta le richieste per host, stato, paese e rete. Predefinito: disattivato. Disattivandole si ferma il nuovo conteggio; le statistiche memorizzate restano finché non scadono, a meno che tu non selezioni "Elimina anche le statistiche memorizzate" nella finestra.
- **Conserva le statistiche per**: da 7 a 365 giorni. Predefinito: 30. I dati al minuto sono conservati per 24 ore, quelli orari per questo numero di giorni.
- **Mostra gli IP dei visitatori**: memorizza gli IP dei visitatori per ora per elencare gli IP principali. Predefinito: disattivato, per la privacy. Disattivandolo si eliminano gli IP memorizzati.
- **Conta i visitatori unici**: memorizza un hash con chiave di ogni IP visitatore per host e giorno per contare i visitatori unici. Predefinito: disattivato. Disattivandolo si eliminano gli hash.
- **Limite di visitatori per host e giorno**: da 1000 a 1000000. Predefinito: 100000. Un host che lo raggiunge smette di contare i nuovi visitatori per quel giorno e mostra un segno più.

Paesi e reti richiedono i database GeoIP (Impostazioni, GeoIP).

Altro nel wiki: Monitoring.
