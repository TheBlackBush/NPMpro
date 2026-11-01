## Ağ

NPMpro'ya, önündeki hangi proxy'lerin gerçek istemci adresi konusunda güvenilebileceğini söyleyin. Bu olmadan günlükler, erişim listeleri ve CrowdSec ziyaretçinin değil proxy'nin adresini görür.

Konteynerde ayarlanmış bir değişken arayüze üstün gelir ve alanı kilitler (alan, "TRUST_IP tarafından ayarlandı" gibi bir kilit rozeti gösterir). Konteynerde ayarlanmamış her şey için arayüzü kullanın.

- **Güvenilen proxy IP'leri**: satır başına bir IPv4 veya IPv6 adresi ya da CIDR aralığı, örneğin `10.0.0.0/8`, `192.168.1.5` veya `fd00::/8`. Bu adreslerden gelen istekler gerçek istemci IP'sini `X-Forwarded-For` içinde iletebilir. NPMpro'nun hemen önündeki bir yük dengeleyici veya tünel için kullanın. Varsayılan: boş (kimseye güvenilmez). Değişken: `TRUST_IP` (boşlukla ayrılmış). Kaydetmenin çalıştırdığı nginx yeniden yüklemesinden sonra uygulanır.
- **Cloudflare'e güven**: Cloudflare IP aralıklarını alır, düzenli olarak yeniler ve onlara güvenir; böylece nginx, Cloudflare'in arkasındaki gerçek istemci IP'lerini görür. Varsayılan: kapalı. Değişken: `TRUST_CLOUDFLARE`. Kaydetmenin çalıştırdığı nginx yeniden yüklemesinden sonra uygulanır. Önce wiki'deki (Security) Cloudflare notlarını okuyun: Cloudflare'i NPMpro'nun önüne koymanın gizlilik ve güvenlik bedelleri vardır.

Yalnızca kontrol ettiğiniz veya tamamen güvendiğiniz adreslere güvenin. Güvenilen bir adres herhangi bir ziyaretçi olduğunu iddia edebilir.

Kaydetme nginx sınamasını geçemezse hiçbir şey kaydedilmez ve nginx iletisi gösterilir.

Wiki'de devamı: Security.
