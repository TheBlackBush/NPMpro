## Hva er en tilgangsliste?

En tilgangsliste beskytter proxy-verter. Den kan be besøkende om brukernavn og passord (Basic-autentisering), tillate eller nekte besøkende etter IP-adresse, eller begge deler. Det hjelper for tjenester uten egen innlogging, eller når du vil holde ukjente klienter ute.

Én liste kan brukes av mange proxy-verter og lokasjoner.

### Detaljer

- **Navn**: påkrevd.
- **Oppfyll en av kravene** (av som standard): en besøkende slipper inn når de oppfyller én av kontrollene, en regel eller en gyldig bruker. Av betyr at de må bestå begge. Den hopper også over en Auth Request på den verten.
- **Send autentisering til upstream** (av som standard): sender den besøkendes `Authorization`-header videre til tjenesten. Av holder innloggingen privat i NPMpro.

### Autorisasjoner

Legg til brukernavn og passord. Brukernavn må være unike i listen og kan ikke inneholde `:`. Når du redigerer en liste, lar du et lagret passord stå tomt for å beholde det.

### Regler

Regler tillater eller nekter en IP-adresse, et CIDR-område (`192.168.1.0/24`, `2001:db8::/32`) eller `unix:`. De brukes i den rekkefølgen du lister dem, og første treff gjelder. Legg spesifikke regler først. En avsluttende `all`-regel lukker listen, satt til tillat eller nekt. Den legges til bare når det finnes minst én annen regel. En liste trenger minst én bruker eller én regel.

### Bruk på proxy-verter

På en proxy-vert velger du listen under **Globale tilgangslister** i fanen Detaljer: **Offentlig tilgjengelig** (ingen liste) eller **Egendefinert**. En egendefinert lokasjon kan bruke **Global** (vertens lister), **Offentlig tilgjengelig** eller sine egne **Egendefinert**-lister.

Du kan knytte flere lister til én vert eller lokasjon. De kontrolleres fra topp til bunn, i den rekkefølgen de vises, og du kan flytte dem opp og ned. **Oppfyll en av kravene** og **Send autentisering til upstream** teller bare på den første listen. Med CrowdSec ser utestengte IP-er utestengelsessiden før passordforespørselen.

Mer i wikien: Host options.
