## Yedekleme ve geri yükleme

Host'larınızı, sertifikalarınızı, kullanıcılarınızı ve ayarlarınızı bir `.npmpro` dosyasına kaydedin ve bu NPMpro örneğinde ya da başka birinde geri yükleyin. Trafik istatistikleri ve günlükler hiçbir zaman yedeğin parçası olmaz.

### Yedek oluştur

- **Neler dahil edilsin**: host'lar, erişim listeleri, sertifikalar, DNS kimlik bilgileri, kullanıcılar, ayarlar ve özel dosyalar gibi bölümler. Başlangıçta hepsi işaretlidir.
- **Gizli bilgileri dahil et**: özel anahtarları, parolaları, iki adımlı doğrulama gizli bilgilerini, DNS kimlik bilgisi değerlerini, OIDC istemci gizli anahtarını ve GeoIP lisans anahtarını ekler. Dosya, iki kez girdiğiniz, en az 12 karakterlik bir **Parola ifadesi** ile şifrelenir. NPMpro bunu saklamaz; bu yüzden onsuz yedek geri yüklenemez.
- Gizli bilgiler olmadan dosya şifrelenmez ve gizli bilgileri içermez. Yine de host adlarını, kullanıcıları ve ayarları içerir; bu yüzden gizli tutun.
- **İndir**, dosyayı bilgisayarınıza kaydeder. **Sunucuda sakla**, dosyayı `/data/backups` içinde saklar.

### Zamanlanmış yedekler

Kendiliğinden yedek alan ve bunları sunucuda saklayan zamanlamalar ekleyin.

- **Ne zaman**: her N saatte bir, günlük, haftalık veya aylık; konteynerin saat diliminde.
- **Koruma**: **Parola ifadesi** (her yerde geri yüklenir), **Örnek anahtarı** (hatırlanacak bir şey yok, yalnızca bu örnekte geri yüklenir) veya **Gizli bilgiler olmadan**.
- **Sakla**: bu zamanlamanın kaç dosyasının saklanacağı. Her başarılı çalıştırmadan sonra eskileri silinir.
- Bir zamanlama hemen çalıştırılabilir, duraklatılabilir, düzenlenebilir veya silinebilir. Başarısız bir çalıştırma, zamanlamada ve kontrol panelinde gösterilir.

Zamanlanmış yedekler sizi kötü değişikliklerden korur, diskin kaybından değil. Bunun için dosyaları başka bir makineye kopyalayın.

### Saklanan yedekler

Sunucudaki dosyaları listeler. Bunları indirin, geri yükleyin veya silin ya da **Yedek yükle**. NPMpro her geri yükleme, birleştirme ve veritabanı taşıma öncesinde bir **Otomatik** yedek alır; parola ifadesi gerektirmez ve yalnızca bu örnekte geri yüklenir.

### Geri yükleme

- **Değiştir**, bu örnekte seçtiğiniz bölümleri yedekteki bölümlerle değiştirir. Kendi hesabınız hiçbir zaman değiştirilmez.
- **Birleştir**, yedekteki öğeleri ekler ve hiçbir şeyi silmez. Bir önizleme gösterir ve her çakışma için seçim yapmanızı sağlar: atla, mevcut öğeyi kullan, yeni olarak ekle veya değiştir.

nginx sonucu reddederse geri yükleme geri alınır. NPMpro'nun daha yeni bir sürümünden alınan yedek geri yüklenemez. Geri yüklenen bazı ayarlar için konteynerin yeniden başlatılması gerekir.

Bu bölümde ortam değişkeni yoktur.

Wiki'de devamı: Backup-and-restore.
