## Co je Proxy Host?

Proxy Host je vstupní brána webové služby. Návštěvníci otevřou vaši doménu v NPMpro a NPMpro předá požadavek službě za ní. Může také přidat TLS (HTTPS) službám, které žádné vlastní nemají. Proxy Hosty jsou nejběžnějším použitím NPMpro.

Pomocí **Klonovat** v nabídce hostitele zkopírujete hostitele do nového okna přidání. Kopie začíná bez doménových jmen, protože doména může patřit jen jednomu zapnutému hostiteli.

### Podrobnosti

- **Doménová jména**: jména, která návštěvníci používají. Povinné. U nového certifikátu vyžadují zástupné znaky (`*.example.com`) DNS výzvu.
- **Schéma**: jak NPMpro komunikuje se službou: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (poskytuje soubory nebo PHP ze složky) nebo `empty` (bez upstreamu). Výchozí `http://`. Změna schématu vypne volby, které se k němu nehodí.
- **Cílový název hostitele / IP / cesta**: adresa služby. Můžete přidat podcestu, například `127.0.0.1/path`. U `path` zadejte místo toho složku. Své soubory připojte pod `/var/www`; složku mimo ni mohou použít jen správci. Název začínající `cu_` odkazuje na váš vlastní blok upstream v nginx (viz Load balancing ve wiki).
- **Port přesměrování**: volitelný. U `path` je to verze PHP.
- **Skupina**: volný štítek, který udržuje dlouhé seznamy přehledné.
- **Možnosti** (všechny ve výchozím stavu vypnuté):
  - **Odesílat hlavičku noindex a blokovat některé boty (user agent)**: žádá vyhledávače, aby web neindexovaly, a blokuje některé crawlery.
  - **Vypnout CrowdSec AppSec**: vypne CrowdSec AppSec jen pro tohoto hostitele. Má účinek, jen když je AppSec nastaven.
  - **Vypnout vyrovnávání požadavků** a **Vypnout vyrovnávání odpovědí**: pro upstreamy http a https. Nechte vyrovnávání zapnuté, pokud nestreamujete nebo nenahráváte velké soubory po rychlém a stabilním spojení. Vypnutí vyrovnávání požadavků vypne také AppSec.
  - **Zapnout kompresi upstreamem**: nechá službu komprimovat vlastní odpovědi. Nechte vypnuté, pokud to služba nepotřebuje. Ne pro `path` a `empty`.
  - **Zapnout fancyindex**: zobrazí výpis souborů, když složka nemá indexový soubor. Jen pro `path`.
- **X-Frame-Options**: `SAMEORIGIN` (výchozí), `DENY`, `none` (odstraní hlavičku) nebo `upstream` (ponechá to, co služba pošle).
- **Auth Request**: před hostitele postaví přihlášení nebo kontrolu botů (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Výchozí `none`. **Upstream pro Auth Request** je volitelný; prázdný použije výchozí hodnotu z Nastavení, Předávané ověřování.
- **Globální seznamy přístupů**: **Veřejně přístupné** (výchozí, bez přihlášení) nebo **Vlastní**, jeden nebo více seznamů přístupů.

Websockety jsou vždy zapnuté.

### Vlastní umístění

Umístění (location) pošle jednu cestu hostitele (například `/api/`) jiné službě. Každé má **Aktivováno**, cestu s volitelným typem shody (`=`, `~`, `~*`, `^~` nebo `@`), vlastní schéma, hostitele, port, možnosti, Auth Request a seznamy přístupů. Jeho seznam přístupů může být **Globální**, což použije seznamy hostitele. Nezdědí Auth Request hostitele. K cestě přidejte koncové lomítko, pokud nechcete shodu podle předpony. Správci mohou přidat vlastní konfiguraci nginx pro každé umístění tlačítkem s ozubeným kolem.

### TLS

- **TLS certifikát**: Žádný, Požádat o nový certifikát, nebo existující. Níže uvedené volby vyžadují certifikát.
- **Certifikát mTLS**: certifikační autorita klientů. **mTLS volitelné** pustí dovnitř návštěvníky bez certifikátu. **mTLS obchází Auth Request** nechá návštěvníky s platným certifikátem přeskočit Auth Request.
- **Vynutit HTTPS** přesměruje HTTP na HTTPS. **Podpora HTTP/3** povolí HTTP/3 (QUIC).
- **HSTS zapnuto (2 roky)**: vyžaduje Vynutit HTTPS. **HSTS pro subdomény + preload** vyžaduje HSTS.
- U nového certifikátu: **Znovu použít klíč (nedoporučeno)** a **Použít DNS výzvu**, s poskytovatelem, přihlašovacími údaji a sekundami propagace.

### Pokročilé

Vlastní konfigurace nginx pro celého hostitele (blok server) a pro hlavní umístění `location /`. Měnit ji mohou jen správci.

Více ve wiki: Host options.
