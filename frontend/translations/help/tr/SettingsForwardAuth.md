## İletilen kimlik doğrulama

İletilen kimlik doğrulama, bir proxy host'un önüne bir oturum açma veya bot denetimi koyar. Her istek için nginx önce bir kimlik doğrulama hizmetine ziyaretçinin geçip geçemeyeceğini sorar. NPMpro bunu Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia ve Authentik için yerleşik olarak sunar. Sağlayıcıyı kendi konteynerinde siz çalıştırırsınız.

Bu sayfa her sağlayıcının varsayılan adresini (yukarı akış) ayarlar. Bir proxy host, denetimi Detaylar sekmesindeki Seçenekler altında **Auth Request** ile (veya bir özel konumda) açar.

Konteynerde ayarlanmış bir değişken arayüze üstün gelir ve alanı kilitler (alan, "AUTH_REQUEST_AUTHELIA_UPSTREAM tarafından ayarlandı" gibi bir kilit rozeti gösterir). Konteynerde ayarlanmamış her şey için arayüzü kullanın. Buradaki her ayar, kaydetmenin çalıştırdığı nginx yeniden yüklemesinden sonra uygulanır. nginx sınaması başarısız olursa hiçbir şey kaydedilmez.

### Varsayılan yukarı akışlar

- **Anubis yukarı akışı**, **Tinyauth yukarı akışı**, **OAuth2 Proxy yukarı akışı**, **VoidAuth yukarı akışı**, **Authelia yukarı akışı**, **Authentik yukarı akışı**: o sağlayıcıyı kullanan ve kendi yukarı akışı olmayan proxy host'lar tarafından kullanılır. Host'un kendi değeri geçerli olur. Varsayılan: boş (yok). Değişkenler: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Biçim: `scheme://host:port`, örneğin `http://127.0.0.1:9091`, ya da adı `cu_` ile başlayan kendi nginx upstream bloğunuz için `scheme://cu_name`. `http` veya `https` kullanın; port zorunludur; IPv6 adresi köşeli parantez içine yazılır. Yol yok, boşluk yok ve `; { } # " ' $ \` karakterlerinden hiçbiri yok.

Proxy host'lar o sağlayıcıyı kendi yukarı akışları olmadan kullanırken bir varsayılanı boşaltamazsınız. İleti bu host'ları listeler.

Hiçbir yerde yukarı akışı olmayan bir sağlayıcıyı kullanan bir host, "Yapılandırma hatası" alır.

### Anubis

- **Özel Anubis resimleri**: Anubis doğrulama sayfalarında kendi `happy.webp`, `reject.webp` ve `pensive.webp` dosyalarınızı gösterir. Varsayılan: üç dosya da varsa ve boş değilse açık, aksi halde kapalı. Değişken: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. Resimler, veri klasörünüzdeki `public/anubis` içine konur.

Wiki'de devamı: Forward-Authentication.
