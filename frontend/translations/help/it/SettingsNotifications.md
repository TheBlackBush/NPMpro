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

Altro nel wiki: Configuration.
