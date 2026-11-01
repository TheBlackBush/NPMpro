## Gelişmiş

NPMpro'nun davranışını küçük şekillerde değiştiren ayarlar.

Konteynerde ayarlanmış bir değişken arayüze üstün gelir ve alanı kilitler (alan, "TZ tarafından ayarlandı" gibi bir kilit rozeti gösterir). Konteynerde ayarlanmamış her şey için arayüzü kullanın.

- **Saat dilimi**: konteynerin saat dilimi. Günlüklerdeki, GoAccess raporundaki ve zamanlanmış yedekler gibi zamanlanmış işlerdeki saatleri belirler. `Europe/Berlin` gibi bir ad kullanın. Varsayılan: `UTC`. Değişken: `TZ`. Konteyner yeniden başlatıldıktan sonra uygulanır: kaydetmek değeri saklar ve bölüm bunu "Uygulamak için konteyneri yeniden başlatın" altında listeler.
- **nginx yapılandırmalarını biçimlendir**: NPMpro'nun yazdığı yapılandırmaları nginxbeautifier ile biçimlendirir. Standart olmayan özel veya gelişmiş yapılandırmalarda başarısız oluyorsa kapatın. Varsayılan: açık. Değişken: `DISABLE_NGINX_BEAUTIFIER` (ters: `true` biçimlendirmeyi kapatır). Hemen uygulanır.
- **Gravatar profil resimleri**: yüklenmiş avatarı olmayan kullanıcıların Gravatar resmini gösterir. Resmi almak için NPMpro, kullanıcının e-posta adresinin bir hash'ini Gravatar'a gönderir; bu sizin için önemliyse kapatın. Varsayılan: açık. Değişken: `DISABLE_GRAVATAR` (ters: `true` kapatır). Hemen uygulanır; kullanıcının resmi bir sonraki profil kaydında değişir ve önceden alınmış resimler o zamana kadar kalır.
