## Avanzate

Impostazioni che modificano in piccolo il comportamento di NPMpro.

Una variabile impostata sul container ha la precedenza sull'interfaccia e blocca il campo (il campo mostra un badge con il lucchetto, ad esempio "Impostato da TZ"). Usa l'interfaccia per tutto ciò che non è impostato nel container.

- **Fuso orario**: il fuso orario del container. Determina gli orari nei log, nel report GoAccess e nelle attività pianificate, come i backup pianificati. Usa un nome come `Europe/Berlin`. Predefinito: `UTC`. Variabile: `TZ`. Si applica dopo il riavvio del container: il salvataggio lo memorizza e la sezione lo elenca sotto "Riavvia il container per applicare".
- **Formatta le configurazioni nginx**: formatta le configurazioni che NPMpro scrive, con nginxbeautifier. Disattivalo se fallisce con configurazioni personalizzate o avanzate non standard. Predefinito: attivo. Variabile: `DISABLE_NGINX_BEAUTIFIER` (invertita: `true` disattiva la formattazione). Si applica subito.
- **Immagini del profilo Gravatar**: mostra l'immagine Gravatar degli utenti che non hanno caricato un avatar. Per recuperare un'immagine, NPMpro invia a Gravatar un hash dell'indirizzo e-mail dell'utente, quindi disattivalo se per te è un problema. Predefinito: attivo. Variabile: `DISABLE_GRAVATAR` (invertita: `true` lo disattiva). Si applica subito; l'immagine di un utente cambia al successivo salvataggio del profilo e quelle già recuperate restano fino ad allora.
