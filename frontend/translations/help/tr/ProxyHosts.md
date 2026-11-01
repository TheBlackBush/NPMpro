## Proxy Host nedir?

Proxy Host, bir web hizmetinin ön kapısıdır. Ziyaretçiler alan adınızı NPMpro'da açar, NPMpro da isteği arkasındaki hizmete iletir. Kendi TLS'si olmayan hizmetler için TLS (HTTPS) de ekleyebilir. Proxy Host'lar NPMpro'nun en yaygın kullanımıdır.

Bir host'u yeni bir Ekle penceresine kopyalamak için host'un menüsündeki **Klonla**'yı kullanın. Kopya alan adları olmadan başlar, çünkü bir alan adı yalnızca bir etkin host'a ait olabilir.

### Detaylar

- **Alan Adları**: ziyaretçilerin kullandığı adlar. Zorunludur. Yeni bir sertifika için joker karakterli adlar (`*.example.com`) DNS challenge gerektirir.
- **Şema**: NPMpro'nun hizmetle nasıl konuştuğu: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (bir klasörden dosya veya PHP sunar) ya da `empty` (yukarı akış yok). Varsayılan `http://`. Şemayı değiştirmek, ona uymayan seçenekleri kapatır.
- **İletilecek Host Adı / IP / Yol**: hizmetin adresi. Bir alt yol ekleyebilirsiniz, örneğin `127.0.0.1/path`. `path` ile bunun yerine bir klasör girin. Dosyalarınızı `/var/www` altına bağlayın; bunun dışındaki bir klasörü yalnızca yöneticiler kullanabilir. `cu_` ile başlayan bir ad, kendi nginx upstream bloğunuza işaret eder (wiki'deki Load balancing bölümüne bakın).
- **İletme Portu**: isteğe bağlıdır. `path` ile PHP sürümüdür.
- **Grup**: uzun listeleri düzenli tutan serbest bir etiket.
- **Seçenekler** (hepsi varsayılan olarak kapalı):
  - **noindex başlığı gönder ve bazı bot user agent'larını engelle**: arama motorlarından siteyi dizinlememelerini ister ve bazı tarayıcıları engeller.
  - **CrowdSec AppSec'i Devre Dışı Bırak**: CrowdSec AppSec'i yalnızca bu host için kapatır. Yalnızca AppSec kurulmuşsa etkisi olur.
  - **İstek Arabelleğe Almayı Devre Dışı Bırak** ve **Yanıt Arabelleğe Almayı Devre Dışı Bırak**: http ve https yukarı akışları için. Hızlı ve kararlı bir bağlantı üzerinden akış yapmıyor veya büyük dosya yüklemiyorsanız arabelleğe almayı açık tutun. İstek arabelleğe almayı kapatmak AppSec'i de kapatır.
  - **Yukarı akış tarafından sıkıştırmayı etkinleştir**: hizmetin kendi yanıtlarını sıkıştırmasına izin verir. Hizmet buna ihtiyaç duymuyorsa kapalı tutun. `path` ve `empty` için değildir.
  - **fancyindex'i etkinleştir**: bir klasörde dizin dosyası yoksa dosya listesi gösterir. Yalnızca `path` için.
- **X-Frame-Options**: `SAMEORIGIN` (varsayılan), `DENY`, `none` (başlığı kaldırır) veya `upstream` (hizmetin gönderdiğini korur).
- **Auth Request**: host'un önüne bir oturum açma veya bot denetimi koyar (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Varsayılan `none`. **Auth Request yukarı akışı** isteğe bağlıdır; boş bırakılırsa Ayarlar, İletilen kimlik doğrulama bölümündeki varsayılan kullanılır.
- **Genel Erişim Listeleri**: **Herkese Açık** (varsayılan, oturum açma yok) veya **Özel**, bir ya da daha fazla Erişim Listesi.

Websockets her zaman açıktır.

### Özel Konumlar

Bir konum, host'un tek bir yolunu (örneğin `/api/`) farklı bir hizmete gönderir. Her birinde **Etkin**, isteğe bağlı bir eşleşme türüne sahip bir yol (`=`, `~`, `~*`, `^~` veya `@`), kendi şeması, host'u, portu, seçenekleri, Auth Request'i ve erişim listeleri bulunur. Erişim listesi **Genel** olabilir; bu, host'un listelerini kullanır. Host'un Auth Request'ini devralmaz. Önek eşleşmesi istemiyorsanız yola sonda bir eğik çizgi ekleyin. Yöneticiler, dişli düğmesiyle her konum için özel nginx yapılandırması ekleyebilir.

### TLS

- **TLS Sertifikası**: Yok, yeni bir sertifika iste veya mevcut bir sertifika. Aşağıdaki seçenekler bir sertifika gerektirir.
- **mTLS Sertifikası**: bir istemci sertifika yetkilisi. **mTLS'yi İsteğe Bağlı Yap**, sertifikası olmayan ziyaretçilerin girmesine izin verir. **mTLS, Auth Request'i atlar**, geçerli sertifikası olan ziyaretçilerin Auth Request'i atlamasını sağlar.
- **HTTPS'i Zorla**, HTTP'yi HTTPS'e yönlendirir. **HTTP/3 Desteği**, HTTP/3'e (QUIC) izin verir.
- **HSTS Etkin (2 Yıl)**: HTTPS'i Zorla gerektirir. **HSTS Alt Alan Adları+Preload**, HSTS gerektirir.
- Yeni bir sertifika için: **Anahtarı Yeniden Kullan (önerilmez)** ve **DNS Challenge Kullan**; sağlayıcı, kimlik bilgisi ve yayılma süresi (saniye) ile.

### Gelişmiş

Tüm host için (server bloğu) ve ana konum `location /` için özel nginx yapılandırması. Yalnızca yöneticiler değiştirebilir.

Wiki'de devamı: Host options.
