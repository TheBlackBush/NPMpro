## Che cos'è una Access List?

Una Access List protegge gli host proxy. Può chiedere ai visitatori un nome utente e una password (autenticazione Basic), consentire o negare l'accesso in base all'indirizzo IP, oppure entrambe le cose. È utile per i servizi che non hanno un login proprio o quando vuoi tenere fuori i client sconosciuti.

Una lista può essere usata da molti host proxy e percorsi.

### Dettagli

- **Nome**: obbligatorio.
- **Soddisfa Qualsiasi** (disattivato per impostazione predefinita): un visitatore entra se supera anche solo un controllo, una regola o un utente valido. Se è disattivato, deve superarli entrambi. Salta anche un Auth Request su quell'host.
- **Passa Autenticazione all'Upstream** (disattivato per impostazione predefinita): inoltra al servizio l'header `Authorization` del visitatore. Se è disattivato, il login resta privato per NPMpro.

### Autorizzazioni

Aggiungi nomi utente e password. I nomi utente devono essere unici nella lista e non possono contenere `:`. Quando modifichi una lista, lascia vuota una password già salvata per mantenerla.

### Regole

Le regole consentono o negano un indirizzo IP, un intervallo CIDR (`192.168.1.0/24`, `2001:db8::/32`) oppure `unix:`. Vengono applicate nell'ordine in cui le elenchi e vince la prima che corrisponde. Metti per prime le regole specifiche. Una regola finale `all` chiude la lista, impostata su consenti o nega; viene aggiunta solo se esiste almeno un'altra regola. Una lista richiede almeno un utente o una regola.

### Uso negli host proxy

In un host proxy, scegli la lista sotto **Liste di accesso globali** nella scheda Dettagli: **Accessibile Pubblicamente** (nessuna lista) oppure **Personalizzata**. Un percorso personalizzato può usare **Globale** (le liste dell'host), **Accessibile Pubblicamente** oppure le proprie liste **Personalizzata**.

Puoi collegare più liste a un host o a un percorso. Vengono controllate dall'alto verso il basso, nell'ordine mostrato, e puoi spostarle su e giù. **Soddisfa Qualsiasi** e **Passa Autenticazione all'Upstream** contano solo sulla prima lista. Con CrowdSec, gli IP bannati vedono la pagina di ban prima della richiesta della password.

Altro nel wiki: Host options.
