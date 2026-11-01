## Erişim Listesi nedir?

Erişim Listesi, proxy host'ları korur. Ziyaretçilerden kullanıcı adı ve parola isteyebilir (Basic kimlik doğrulama), ziyaretçilere IP adresine göre izin verebilir ya da onları engelleyebilir, ya da ikisini birden yapabilir. Kendi girişi olmayan hizmetler için veya bilinmeyen istemcileri dışarıda tutmak istediğinizde işe yarar.

Bir liste birçok proxy host ve konum tarafından kullanılabilir.

### Detaylar

- **Ad**: zorunludur.
- **Herhangi Birini Karşıla** (varsayılan olarak kapalı): ziyaretçi, herhangi bir denetimle (bir kural ya da geçerli bir kullanıcı) eşleşirse içeri girer. Kapalıyken ikisini de geçmesi gerekir. Ayrıca o host'taki Auth Request'i atlar.
- **Kimlik Doğrulamayı Yukarı Akışa İlet** (varsayılan olarak kapalı): ziyaretçinin `Authorization` başlığını hizmete iletir. Kapalıyken oturum bilgisi NPMpro içinde kalır.

### Yetkilendirmeler

Kullanıcı adları ve parolalar ekleyin. Kullanıcı adları liste içinde benzersiz olmalı ve `:` içeremez. Bir listeyi düzenlerken, kayıtlı bir parolayı korumak için alanı boş bırakın.

### Kurallar

Kurallar bir IP adresine, bir CIDR aralığına (`192.168.1.0/24`, `2001:db8::/32`) veya `unix:` değerine izin verir ya da onu engeller. Kurallar, sıraladığınız sırayla uygulanır ve ilk eşleşme geçerli olur. Önce özel kuralları koyun. Son bir `all` kuralı listeyi kapatır, izin veya engelleme olarak ayarlanır; yalnızca başka en az bir kural varsa eklenir. Bir listede en az bir kullanıcı ya da bir kural olmalıdır.

### Proxy host'larda kullanım

Bir proxy host'ta listeyi Detaylar sekmesindeki **Genel Erişim Listeleri** altından seçin: **Herkese Açık** (liste yok) veya **Özel**. Özel bir konum **Genel** (host'un listeleri), **Herkese Açık** veya kendi **Özel** listelerini kullanabilir.

Bir host'a veya konuma birden fazla liste bağlayabilirsiniz. Listeler, gösterilen sırayla yukarıdan aşağıya denetlenir ve bunları yukarı ve aşağı taşıyabilirsiniz. **Herhangi Birini Karşıla** ve **Kimlik Doğrulamayı Yukarı Akışa İlet** yalnızca ilk listede geçerlidir. CrowdSec ile yasaklı IP'ler, parola istemi yerine önce yasak sayfasını görür.

Wiki'de devamı: Host options.
