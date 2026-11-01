## Şəbəkə

NPMpro-ya onun qarşısındakı hansı proksilərə real klient ünvanı barədə inanmaq olar, bildirin. Bu olmadan jurnallar, giriş siyahıları və CrowdSec ziyarətçinin deyil, proksinin ünvanını görür.

Konteynerdə təyin edilmiş dəyişən UI-dan üstündür və sahəni kilidləyir (sahədə "TRUST_IP ilə təyin edilib" kimi kilid nişanı görünür). Konteynerdə təyin edilməyən hər şey üçün UI-dan istifadə edin.

- **Etibarlı proksi IP-ləri**: hər sətirdə bir IPv4 və ya IPv6 ünvanı və ya CIDR aralığı, məsələn `10.0.0.0/8`, `192.168.1.5` və ya `fd00::/8`. Bu ünvanlardan gələn sorğular real klient IP-sini `X-Forwarded-For` ilə ötürə bilər. NPMpro-nun birbaşa qarşısındakı yük balanslaşdırıcı və ya tunel üçün istifadə edin. Standart: boş (heç kimə etibar edilmir). Dəyişən: `TRUST_IP` (boşluqla ayrılır). Saxlamanın işlətdiyi nginx reload-undan sonra tətbiq olunur.
- **Cloudflare-ə etibar et**: Cloudflare IP aralıqlarını alır, mütəmadi yeniləyir və onlara etibar edir, beləliklə nginx Cloudflare-in arxasındakı real klient IP-lərini görür. Standart: söndürülüb. Dəyişən: `TRUST_CLOUDFLARE`. Saxlamanın işlətdiyi nginx reload-undan sonra tətbiq olunur. Əvvəlcə vikidə Cloudflare haqqında qeydləri (Security) oxuyun: Cloudflare-i NPMpro-nun qarşısına qoymağın məxfilik və təhlükəsizlik xərcləri var.

Yalnız nəzarət etdiyiniz və ya tam güvəndiyiniz ünvanlara etibar edin. Etibarlı ünvan istənilən ziyarətçi olduğunu iddia edə bilər.

Saxlama nginx testindən keçməzsə, heç nə saxlanmır və nginx mesajı göstərilir.

Vikidə daha ətraflı: Security.
