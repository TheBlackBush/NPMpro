## Co je Redirection Host?

Redirection Host posílá návštěvníky jedné domény na jinou adresu. Použijte ho, když web změní doménu a staré odkazy mají dál fungovat, nebo pro přesměrování `www` na hlavní jméno.

Pomocí **Klonovat** v nabídce hostitele zkopírujete hostitele do nového okna přidání. Kopie začíná bez doménových jmen, protože doména může patřit jen jednomu zapnutému hostiteli.

### Podrobnosti

- **Doménová jména**: jména, která se přesměrovávají. Povinné. Zástupné znaky jsou u nového certifikátu povoleny jen s DNS výzvou.
- **Schéma**: schéma cíle. "zachovat (stejné jako požadavek)" je výchozí a ponechá `http` nebo `https` z návštěvy. Nebo vyberte `http` či `https`.
- **Cílová doména**: doména, na kterou se návštěvníci posílají, například `example.com`. Povinná.
- **HTTP kód**: kód odpovědi. Výchozí 301 Moved permanently. Další možnosti: 302 Moved temporarily, 303 See other, 307 Temporary redirect a 308 Permanent redirect. Použijte 301 nebo 308, když je přesun trvalý; prohlížeče a vyhledávače si je pamatují.
- **Skupina**: volný štítek, který udržuje dlouhé seznamy přehledné. Vyberte používanou nebo napište nový název.
- **Zachovat cestu** (ve výchozím stavu vypnuto): přidá k cíli původní cestu a dotaz. Při zapnutí se `old.example/a?b=1` dostane na `new.example/a?b=1`. Bez toho každý návštěvník skončí na začátku cíle.

### TLS

- **TLS certifikát**: Žádný, Požádat o nový certifikát, nebo existující. Níže uvedené volby vyžadují certifikát.
- **Certifikát mTLS**: certifikační autorita klientů. **mTLS volitelné** pustí dovnitř návštěvníky bez klientského certifikátu.
- **Vynutit HTTPS**: nejdříve přesměruje HTTP na HTTPS.
- **Podpora HTTP/3**: povolí HTTP/3 (QUIC).
- **HSTS zapnuto (2 roky)**: vyžaduje Vynutit HTTPS. **HSTS pro subdomény + preload** vyžaduje HSTS.
- U nového certifikátu: **Znovu použít klíč (nedoporučeno)** a **Použít DNS výzvu**, s poskytovatelem, přihlašovacími údaji a sekundami propagace.

Všechny volby TLS jsou ve výchozím stavu vypnuté.

### Pokročilé

Vlastní konfigurace nginx přidaná dovnitř bloku server hostitele. Měnit ji mohou jen správci; ostatní uživatelé ji vidí jen pro čtení.

Více ve wiki: Host options.
