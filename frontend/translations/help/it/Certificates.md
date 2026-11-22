## Guida sui Certificati

### Certificato HTTP

Un certificato convalidato HTTP significa che i server Certbot tenteranno di raggiungere i tuoi domini tramite HTTP (non HTTPS!) e, in caso di esito positivo, emetteranno il tuo certificato.

Per questo metodo, dovrai creare un _Proxy Host_ per i tuoi domini chesia accessibile con HTTP e che punti a questa installazione Nginx.
Dopo che il certificato è stato rilasciato, puoi modificare il _Proxy Host_ per utilizzare questo certificato anche per le connessioni HTTPS.
Tuttavia, il _Proxy Host_ dovrà comunque essere configurato per l'accesso HTTP affinché il certificato possa essere rinnovato.

Questo processo _non_ supporta i domini wildcard.

### Certificato DNS

Un certificato convalidato dal DNS richiede l'uso di un plugin DNS Provider. Questo DNS Provider verrà utilizzato per creare record temporanei sul tuo dominio,
quindi Certbot interrogherà tali record per assicurarsi che tu sia il proprietario e, in caso di esito positivo,rilascerà il tuo certificato.

Non è necessario creare un _Proxy Host_ prima di richiedere questo tipo di certificato. Non è nemmeno necessario configurare il tuo _proxy host_ per l'accesso HTTP.

Questo processo _supporta_ i domini wildcard.

#### Credenziali DNS salvate

Le credenziali per il tuo DNS Provider vengono salvate separatamente dal certificato, nella
scheda _Credenziali DNS_ della pagina Certificati. Un certificato sceglie poi solo una delle
credenziali salvate, quindi più certificati possono condividerle.

I segreti vengono memorizzati cifrati e non vengono mai più mostrati. Quando modifichi una credenziale, lascia
vuoto un segreto per mantenere il valore salvato. La chiave usata per la cifratura è il file
`/data/npmpro/dns-credentials.key`: esegui il backup insieme al database, altrimenti
le credenziali salvate non potranno essere lette dopo un ripristino.

I provider senza un modulo usano la casella di testo INI, in cui incolli il contenuto del
file delle credenziali per quel provider.

#### Domini

Una credenziale elenca i domini (zone DNS) che gestisce, come `example.com`. La scheda **Domini** della pagina Certificati elenca i domini di tutte le tue credenziali.

Il campo **Nomi di Dominio** suggerisce i domini delle tue credenziali DNS e i nomi già usati da host e certificati (i nomi di uno stream provengono dal suo certificato). Si può sempre digitare un altro nome: `Aggiungi <nome>` è il primo e Invio aggiunge ciò che hai digitato.

Con la challenge DNS, la finestra suggerisce la credenziale DNS i cui domini coprono tutti i nomi e ne indica il motivo. Puoi cambiarla in qualsiasi momento e una credenziale scelta da te viene mantenuta.

### Certificato personalizzato

Utilizza questa opzione per caricare il tuo certificato TLS, fornito dalla tua autorità di certificazione.

### Autorità di certificazione

Un certificato richiesto a un server ACME è emesso dalla CA scelta nella sua finestra: la CA dell'istanza (contrassegnata come «predefinita») o un'altra CA aggiunta da un amministratore in Impostazioni, Certificati e TLS, sotto **Altre CA**. L'elenco mostra la CA di ogni certificato nella colonna **CA**. **Riemetti** nel menu del certificato lo richiede di nuovo a un'altra CA con lo stesso nome; se fallisce, il certificato attuale resta. **Modifica** su un certificato ACME cambia i suoi nomi di dominio: il certificato viene richiesto di nuovo sotto la stessa voce, la finestra avvisa dei nomi che gli host usano ancora e un errore non cambia nulla.
