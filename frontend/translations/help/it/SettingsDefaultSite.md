## Sito Predefinito

Il sito predefinito è ciò che nginx risponde quando un visitatore raggiunge NPMpro con un nome host che nessun host usa, o con l'indirizzo IP del server. Qui scegli la risposta. Vale per tutti i nomi sconosciuti.

Il salvataggio prova prima la nuova scelta con nginx. Se la prova fallisce, non viene salvato nulla, resta il sito predefinito precedente e l'errore di nginx compare nel log del container.

- **Pagina di Congratulazioni** (predefinita): mostra la pagina di benvenuto di NPMpro.
- **Pagina 404**: risponde con una pagina 404 Not Found.
- **Nessuna Risposta (444)**: chiude la connessione senza alcuna risposta. Usala per non dare nulla da vedere agli scanner. Le richieste HTTPS per nomi sconosciuti vengono rifiutate durante l'handshake TLS.
- **Reindirizzamento**: invia i visitatori a un altro indirizzo con un reindirizzamento temporaneo (302). Inserisci un URL completo `http://` o `https://` senza spazi, virgolette o `; { } #`, fino a 255 caratteri.
- **HTML Personalizzato**: mostra una tua pagina HTML. Il **Codice di stato HTTP** sotto è facoltativo, da 400 a 599. Lascialo vuoto per 200 (OK).

Per ogni scelta tranne Nessuna Risposta, le richieste a nomi sconosciuti su HTTP semplice vengono prima reindirizzate a HTTPS, e le richieste HTTPS usano il certificato scelto come **Certificato predefinito** in Impostazioni, Certificati e TLS.

Questa sezione non ha variabili d'ambiente, quindi la modifica si applica al salvataggio.
