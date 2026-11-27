## Notifiche

NPMpro invia la posta attraverso un server SMTP a tua scelta. Per ora la posta serve per la mail di prova e in seguito per il ripristino della password e per gli avvisi. Le impostazioni qui possono anche arrivare da variabili del container: una variabile impostata sul container prevale sull'interfaccia e blocca il suo campo (il campo mostra "Impostato dall'ambiente"). Usa l'interfaccia per tutto ciò che non è impostato nel container.

### Server di posta

Ogni connessione viene controllata come le altre richieste in uscita: il nome del server deve risolversi e gli indirizzi locali e link-local sono rifiutati. La posta è considerata configurata quando l'host e l'indirizzo del mittente sono compilati.

- **Host** e **Porta**: il server SMTP. Variabili: `SMTP_HOST`, `SMTP_PORT` (predefinita 587).
- **Sicurezza**: **STARTTLS** porta una connessione in chiaro a una cifrata (di solito la porta 587), **TLS** è cifrato fin dall'inizio (di solito la porta 465), **Nessuna** invia senza crittografia. Variabile: `SMTP_SECURITY` (`starttls`, `tls` o `none`).
- **Verifica certificato**: rifiuta un server il cui certificato non è valido. Variabile: `SMTP_VERIFY_TLS` (`false` lo disattiva).
- **Utente** e **Password**: l'accesso. La password viene salvata cifrata e mai più mostrata; **Rimuovi** la elimina, e se quella salvata non può essere decifrata, digitala di nuovo. Variabili: `SMTP_USERNAME`, `SMTP_PASSWORD`.
- **Nome del mittente** e **Indirizzo del mittente**: come appare la posta di NPMpro. Variabili: `SMTP_FROM_NAME`, `SMTP_FROM`.
- **Rispondi a**: dove vanno le risposte; vuoto usa l'indirizzo del mittente. Variabile: `SMTP_REPLY_TO`.

Con la sicurezza **Nessuna** e un utente, la password viaggerebbe senza crittografia, quindi è consentito solo per un server della tua rete locale.

**Invia mail di prova** invia una mail con le impostazioni salvate all'indirizzo che digiti (il tuo per impostazione predefinita) e mostra la risposta del server se fallisce. Salva prima: il pulsante è disattivato finché il modulo ha modifiche non salvate e nascosto finché la posta non è configurata.

### Avvisi via mail

Mostrati quando un server di posta è configurato. Mail sui problemi che NPMpro rileva e su quando vengono risolti; un problema che resta aperto viene ripetuto.

- **Invia agli amministratori**: ogni amministratore attivo con un indirizzo valido riceve gli avvisi.
- **Invia anche a**: altri indirizzi, al massimo 20, ad esempio una lista del team. Un indirizzo rifiutato è segnato sul suo chip. Variabile: `ALERT_ADDRESSES` (separati da virgole).
- **Eventi**: spunta i problemi per cui vuoi ricevere una mail, raggruppati per area. Spuntarne uno copre anche la sua risoluzione.
- **Ricorda ogni (ore)**: per quanto tempo un problema resta silenzioso prima di essere inviato di nuovo; 0 non lo ripete mai, al massimo 168.

**Invia un esempio** invia subito un avviso di esempio, con le impostazioni salvate, a tutti quelli che riceverebbero gli avvisi. Salva prima: il pulsante è disattivato finché il modulo ha modifiche non salvate. Se un invio non riesce, il messaggio indica l'indirizzo.

### Link e lingua

- **URL pubblico**: l'indirizzo con cui le persone aprono NPMpro, usato per i link delle mail, ad esempio `https://npm.example.com`. Solo HTTPS, senza percorso. **Usa l'indirizzo di questo browser** lo compila con l'indirizzo di questa pagina quando è aperta tramite HTTPS. Variabile: `PUBLIC_URL`.
- **Lingua predefinita delle mail**: la lingua delle mail per le persone che non ne hanno scelta una. La lingua dell'interfaccia di ogni utente viene ricordata e usata per le sue mail. Variabile: `MAIL_LANGUAGE`.

### Inviti e avvisi dell'account

Entrambi richiedono un server di posta. Gli inviti richiedono anche l'**URL pubblico**.

- **Inviti**: quando aggiungi un utente puoi inviare un invito invece di impostare una password. L'utente riceve un'email con un link per scegliere la password; il link funziona una sola volta e per 72 ore. **Invia di nuovo l'invito** nell'elenco degli utenti invia un nuovo link.
- **Avvisi dell'account**: gli utenti ricevono un'email quando cambiano la password o l'indirizzo, quando l'accesso a due fattori viene disattivato o quando vengono creati nuovi codici di backup.

### Webhook

Un webhook è un indirizzo tuo che NPMpro chiama con una richiesta HTTP firmata quando succede qualcosa, per esempio quando un certificato è stato rinnovato. Solo gli amministratori vedono questa scheda.

- **URL**: `https://` verso qualsiasi host pubblico, oppure `http://` verso un indirizzo della tua rete locale. I reindirizzamenti non vengono seguiti. L'indirizzo è salvato cifrato e non viene più mostrato; lascia il campo vuoto durante la modifica per mantenerlo.
- **Eventi**: scegli gli eventi da inviare, oppure **Tutti gli eventi**.
- **Segreto di firma**: mostrato una sola volta dopo il salvataggio. Conservalo dove lo legge il tuo ricevente. **Rinnova segreto** ne crea uno nuovo; il vecchio continua a firmare per 24 ore, così il ricevente può passare al nuovo.
- **Invia test**: invia subito un evento di prova e mostra lo stato e il tempo impiegato. Non compare in Invii.
- **Invii**: gli eventi più recenti del webhook con stato, tentativi e risposta del ricevente. **Invia di nuovo** rimanda un invio fallito, fino a 7 giorni dopo il fallimento.
- Una richiesta fallita viene ritentata fino a 8 volte in circa 41 ore. Un webhook viene disattivato quando il ricevente risponde 410 Gone, oppure quando fallisce di nuovo dopo 3 giorni di fallimenti senza alcun successo. Un webhook disattivato mostra il motivo; attivalo per usarlo di nuovo.
- Verifica ogni richiesta con una qualsiasi libreria Standard Webhooks, usando il corpo originale e il `webhook-id` come chiave di idempotenza.

Altro nel wiki: Configuration.
