## Varsayılan Site

Varsayılan site, bir ziyaretçi hiçbir host'un kullanmadığı bir host adıyla ya da sunucunun IP adresiyle NPMpro'ya geldiğinde nginx'in verdiği yanıttır. Yanıtı buradan seçin. Tüm bilinmeyen adlara uygulanır.

Kaydetmek, yeni seçimi önce nginx ile sınar. Sınama başarısız olursa hiçbir şey kaydedilmez, önceki varsayılan site kalır ve nginx hatası konteyner günlüğünde yer alır.

- **Tebrikler Sayfası** (varsayılan): NPMpro karşılama sayfasını gösterir.
- **404 Sayfası**: 404 Not Found sayfasıyla yanıt verir.
- **Yanıt Yok (444)**: bağlantıyı hiçbir yanıt vermeden kapatır. Tarayıcılara görecek bir şey vermemek için kullanın. Bilinmeyen adlar için HTTPS istekleri TLS el sıkışması sırasında reddedilir.
- **Yönlendir**: ziyaretçileri geçici bir yönlendirmeyle (302) başka bir adrese gönderir. Boşluk, tırnak veya `; { } #` içermeyen, en çok 255 karakterlik tam bir `http://` ya da `https://` URL'si girin.
- **Özel HTML**: kendi HTML sayfanızı gösterir. Altındaki **HTTP Durum Kodu** isteğe bağlıdır, 400 ile 599 arasındadır. 200 (OK) için boş bırakın.

Yanıt Yok dışındaki her seçimde, bilinmeyen adlara düz HTTP üzerinden gelen istekler önce HTTPS'e yönlendirilir ve HTTPS istekleri, Ayarlar, Sertifikalar ve TLS bölümünde **Varsayılan sertifika** olarak seçilen sertifikayı kullanır.

Bu bölümde ortam değişkeni yoktur, bu yüzden değişiklik kaydettiğinizde uygulanır.
