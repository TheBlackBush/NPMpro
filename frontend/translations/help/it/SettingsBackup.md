## Backup e ripristino

Salva i tuoi host, certificati, utenti e impostazioni in un file `.npmpro` e ripristinalo su questa o su un'altra istanza di NPMpro. Le statistiche del traffico e i log non fanno mai parte di un backup.

### Crea backup

- **Cosa includere**: parti come host, liste di accesso, certificati, credenziali DNS, utenti, impostazioni e file personalizzati. All'inizio sono tutte selezionate.
- **Includi i segreti**: aggiunge chiavi private, password, segreti dell'autenticazione a due fattori, valori delle credenziali DNS, il client secret OIDC e la chiave di licenza GeoIP. Il file è cifrato con una **Passphrase** di almeno 12 caratteri, che inserisci due volte. NPMpro non la memorizza, quindi senza di essa il backup non può essere ripristinato.
- Senza segreti il file non è cifrato e li lascia fuori. Contiene comunque nomi host, utenti e impostazioni, quindi tienilo privato.
- **Scarica** salva il file sul tuo computer. **Conserva sul server** lo memorizza in `/data/backups`.

### Backup pianificati

Aggiungi pianificazioni che creano backup in autonomia e li conservano sul server.

- **Quando**: ogni N ore, ogni giorno, ogni settimana o ogni mese, nel fuso orario del container.
- **Protezione**: **Passphrase** (si ripristina ovunque), **Chiave dell'istanza** (niente da ricordare, si ripristina solo su questa istanza) oppure **Senza segreti**.
- **Conserva**: quanti file di questa pianificazione conservare. I più vecchi vengono eliminati dopo ogni esecuzione riuscita.
- Una pianificazione può essere eseguita subito, messa in pausa, modificata o eliminata. Un'esecuzione fallita viene mostrata sulla pianificazione e nella dashboard.

I backup pianificati ti proteggono dalle modifiche sbagliate, non dalla perdita del disco. Per questo copia i file su un'altra macchina.

### Backup memorizzati

Elenca i file sul server. Scaricali, ripristinali o eliminali, oppure usa **Carica backup**. NPMpro crea un backup **Automatico** prima di ogni ripristino, unione e spostamento del database; non richiede passphrase e si ripristina solo su questa istanza.

### Ripristino

- **Sostituisci** sostituisce le parti che scegli su questa istanza con quelle del backup. Il tuo account non viene mai sostituito.
- **Unisci** aggiunge gli elementi del backup e non elimina nulla. Mostra un'anteprima e ti lascia scegliere per ogni conflitto: saltare, usare l'elemento esistente, aggiungere come nuovo o sostituire.

Un ripristino viene annullato se nginx rifiuta il risultato. Un backup di una versione di NPMpro più recente non può essere ripristinato. Alcune impostazioni ripristinate richiedono il riavvio del container.

Questa sezione non ha variabili d'ambiente.

Altro nel wiki: Backup-and-restore.
