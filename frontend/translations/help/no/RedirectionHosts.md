## Hva er en omdirigeringsvert?

En omdirigeringsvert sender besøkende fra ett domene til en annen adresse. Bruk den når et nettsted bytter domene og gamle lenker skal fortsette å virke, eller for å sende `www` til hovednavnet.

Bruk **Klon** i vertens meny for å kopiere en vert til et nytt Legg til-vindu. Kopien starter uten domenenavnene, fordi et domene bare kan tilhøre én aktivert vert.

### Detaljer

- **Domener**: navnene som omdirigeres. Påkrevd. Jokertegn er bare tillatt for et nytt sertifikat med DNS-utfordringen.
- **Skjema**: skjemaet til målet. «behold (samme som forespørselen)» er standard og beholder `http` eller `https` fra besøket. Eller velg `http` eller `https`.
- **Viderekoble domene**: domenet de besøkende sendes til, for eksempel `example.com`. Påkrevd.
- **HTTP-kode**: svarkoden. Standard er 301 Moved permanently. Andre valg: 302 Moved temporarily, 303 See other, 307 Temporary redirect og 308 Permanent redirect. Bruk 301 eller 308 når flyttingen er permanent. Nettlesere og søkemotorer husker dem.
- **Gruppe**: en fri etikett som holder lange lister ryddige. Velg en som er i bruk, eller skriv et nytt navn.
- **Behold sti** (av som standard): legger den opprinnelige stien og spørringen til målet. Med den på går `old.example/a?b=1` til `new.example/a?b=1`. Uten den havner alle besøkende på starten av målet.

### TLS

- **TLS-sertifikat**: Ingen, be om et nytt sertifikat, eller et eksisterende. Alternativene under krever et sertifikat.
- **mTLS-sertifikat**: en sertifiseringsinstans for klientsertifikater. **Gjør mTLS valgfritt** slipper inn besøkende uten klientsertifikat.
- **Tving HTTPS**: omdirigerer HTTP til HTTPS først.
- **HTTP/3-støtte**: tillater HTTP/3 (QUIC).
- **HSTS aktivert (2 år)**: krever Tving HTTPS. **HSTS for underdomener + preload** krever HSTS.
- For et nytt sertifikat: **Gjenbruk nøkkel (anbefales ikke)** og **Bruk DNS Utfordring**, med leverandør, legitimasjon og sekunder for propagering.

Alle TLS-alternativer er av som standard.

### Avansert

Egendefinert nginx-konfigurasjon som legges inn i vertens server-blokk. Bare administratorer kan endre den. Andre brukere ser den skrivebeskyttet.

Mer i wikien: Host options.
