## Accesso API

Tutti i token API di tutti gli utenti. Solo gli amministratori vedono questa pagina.

I token sono creati dai loro proprietari nel menu utente, in **Token API**. Qui vedi ogni token con il suo proprietario, i permessi, la scadenza, l'ultimo utilizzo e la data di creazione.

- **Revoca** ferma un token subito. Gli script e gli assistenti IA che lo usano ricevono poi un errore di autenticazione.
- Un token non ha mai più permessi del suo proprietario. Il token di un amministratore agisce da amministratore solo con il suo interruttore **Amministratore**, e nessun token gestisce gli utenti.
- Creazione, revoca, scadenza e primo utilizzo di un token sono scritti nel registro di audit, con il nome del token accanto all'utente.

La documentazione dell'API si apre in una nuova scheda.
