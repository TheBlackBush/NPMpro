## Mis on ümbersuunamishost?

Ümbersuunamishost saadab ühe domeeni külastajad teisele aadressile. Kasuta seda, kui sait vahetab domeeni ja vanad lingid peavad edasi töötama, või `www` suunamiseks põhinimele.

Kasuta hosti menüüs valikut **Klooni**, et kopeerida host uude Lisa-aknasse. Koopia algab ilma domeeninimedeta, sest domeen võib kuuluda ainult ühele lubatud hostile.

### Üksikasjad

- **Domeeninimed**: nimed, mida suunatakse ümber. Kohustuslik. Metamärgid on uue sertifikaadi puhul lubatud ainult DNS-väljakutsega.
- **Skeem**: sihtmärgi skeem. "keep (sama mis päringus)" on vaikimisi ja säilitab külastuse `http` või `https`. Või vali `http` või `https`.
- **Sihtkoha domeen**: domeen, kuhu külastajad saadetakse, näiteks `example.com`. Kohustuslik.
- **HTTP-kood**: vastuse kood. Vaikimisi 301 Moved permanently. Muud valikud: 302 Moved temporarily, 303 See other, 307 Temporary redirect ja 308 Permanent redirect. Kasuta 301 või 308, kui kolimine on jäädav; brauserid ja otsingumootorid jätavad need meelde.
- **Rühm**: vaba silt, mis hoiab pikad loendid korras. Vali kasutusel olev või kirjuta uus nimi.
- **Säilita tee** (vaikimisi väljas): lisab sihtmärgile algse tee ja päringu. Sees suunab `old.example/a?b=1` aadressile `new.example/a?b=1`. Ilma selleta jõuab iga külastaja sihtmärgi algusesse.

### TLS

- **TLS-sertifikaat**: Puudub, Taotle uut sertifikaati või olemasolev. Allpool olevad valikud vajavad sertifikaati.
- **mTLS-sertifikaat**: kliendisertifikaatide sertifitseerimiskeskus. **Muuda mTLS valikuliseks** laseb sisse ka kliendisertifikaadita külastajad.
- **Sunni HTTPS**: suunab HTTP esmalt HTTPS-ile ümber.
- **HTTP/3 tugi**: lubab HTTP/3 (QUIC).
- **HSTS sees (2 aastat)**: vajab valikut Sunni HTTPS. **HSTS alamdomeenid+Preload** vajab HSTS-i.
- Uue sertifikaadi jaoks: **Kasuta võtit uuesti (pole soovitatav)** ja **Kasuta DNS-väljakutset**, koos pakkuja, volituste ja levimise sekunditega.

Kõik TLS-i valikud on vaikimisi väljas.

### Täpsemad

Kohandatud nginxi konfiguratsioon, mis lisatakse hosti server-plokki. Seda saavad muuta ainult administraatorid; teised kasutajad näevad seda ainult lugemiseks.

Rohkem wikis: Host options.
