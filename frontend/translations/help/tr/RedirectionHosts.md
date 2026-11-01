## Yönlendirme Host'u nedir?

Yönlendirme Host'u, bir alan adının ziyaretçilerini başka bir adrese gönderir. Bir site alan adı değiştirdiğinde ve eski bağlantıların çalışmaya devam etmesi gerektiğinde ya da `www` adresini ana ada göndermek için kullanın.

Bir host'u yeni bir Ekle penceresine kopyalamak için host'un menüsündeki **Klonla**'yı kullanın. Kopya alan adları olmadan başlar, çünkü bir alan adı yalnızca bir etkin host'a ait olabilir.

### Detaylar

- **Alan Adları**: yönlendirilen adlar. Zorunludur. Yeni bir sertifika için joker karakterli adlara yalnızca DNS challenge ile izin verilir.
- **Şema**: hedefin şeması. Varsayılan "keep (istekle aynı)" (istekteki gibi) olup ziyaretteki `http` veya `https` değerini korur. Ya da `http` veya `https` seçin.
- **İletme Alan Adı**: ziyaretçilerin gönderildiği alan adı, örneğin `example.com`. Zorunludur.
- **HTTP Kodu**: yanıt kodu. Varsayılan 301 Moved permanently. Diğer seçenekler: 302 Moved temporarily, 303 See other, 307 Temporary redirect ve 308 Permanent redirect. Taşınma kalıcıysa 301 veya 308 kullanın; tarayıcılar ve arama motorları bunları hatırlar.
- **Grup**: uzun listeleri düzenli tutan serbest bir etiket. Kullanımda olan birini seçin veya yeni bir ad yazın.
- **Yolu Koru** (varsayılan olarak kapalı): özgün yolu ve sorguyu hedefe ekler. Açıkken `old.example/a?b=1` adresi `new.example/a?b=1` adresine gider. Kapalıyken her ziyaretçi hedefin başına düşer.

### TLS

- **TLS Sertifikası**: Yok, yeni bir sertifika iste veya mevcut bir sertifika. Aşağıdaki seçenekler bir sertifika gerektirir.
- **mTLS Sertifikası**: bir istemci sertifika yetkilisi. **mTLS'yi İsteğe Bağlı Yap**, istemci sertifikası olmayan ziyaretçilerin girmesine izin verir.
- **HTTPS'i Zorla**: önce HTTP'yi HTTPS'e yönlendirir.
- **HTTP/3 Desteği**: HTTP/3'e (QUIC) izin verir.
- **HSTS Etkin (2 Yıl)**: HTTPS'i Zorla gerektirir. **HSTS Alt Alan Adları+Preload**, HSTS gerektirir.
- Yeni bir sertifika için: **Anahtarı Yeniden Kullan (önerilmez)** ve **DNS Challenge Kullan**; sağlayıcı, kimlik bilgisi ve yayılma süresi (saniye) ile.

Tüm TLS seçenekleri varsayılan olarak kapalıdır.

### Gelişmiş

Host'un server bloğunun içine eklenen özel nginx yapılandırması. Yalnızca yöneticiler değiştirebilir; diğer kullanıcılar bunu salt okunur görür.

Wiki'de devamı: Host options.
