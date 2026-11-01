## Veritabanı

NPMpro'nun host'larını, sertifikalarını, kullanıcılarını, günlüklerini ve istatistiklerini sakladığı veritabanı. Varsayılan olarak bu, tek bir dosya olan SQLite'tır ve önerilen seçimdir. Buradan her şeyi MySQL'e, MariaDB'ye, PostgreSQL'e veya yeni bir SQLite dosyasına taşıyabilirsiniz. Kullanımdaki veritabanı bir taşımayla değişmez.

### Kullanımdaki veritabanı

Motoru ve sürümü, nerede olduğunu, boyutunu ve bağlantının **Kaynak**'ını gösterir: **Varsayılan** (SQLite dosyası `/data/npmpro/database.sqlite`), **Veritabanı ayarları dosyası** (`/data/npmpro/database.json`, bir taşıma tarafından yazılır) veya **Ortam** (`DB_MYSQL_*` veya `DB_POSTGRES_*` değişkenleri). Bir taşımadan sonra, ne zaman ve hangi motordan taşındığını söyler.

### Tablolar

Her tablo, satırları ve boyutuyla. Kart daraltılabilir.

### Başka bir veritabanına taşı

Önce sunucunuzda boş bir veritabanı ve tablo oluşturabilen bir kullanıcı oluşturun; NPMpro veritabanını oluşturmaz. Gereksinimler: MySQL 8.0, MariaDB 10.6 veya PostgreSQL 13 ya da daha yenisi.

1. **Motor**'u seçin ve **Host**, **Port**, **Veritabanı adı**, **Kullanıcı** ve **Parola** girin. Sunucu gerektiriyorsa **TLS kullan**'yi açın (MySQL ve MariaDB için ayrıca **Sunucu sertifikasını kontrol et** ve **Sunucu adını kontrol et** de seçebilirsiniz). SQLite'a taşıma hiçbir şey gerektirmez: `/data/npmpro` içinde yeni bir dosya oluşturur.
2. **Bağlantıyı test et**. Sürümü, veritabanının boş olduğunu ve kullanıcının tablo oluşturabildiğini denetler. Hiçbir şeyi değiştirmez.
3. **Taşı**, ardından istenen sözcüğü yazın ve **Şimdi taşı**'ya tıklayın.

NPMpro değişiklikleri duraklatır, bir güvenlik yedeği alır, tabloları oluşturur, her satırı kopyalayıp denetler, sonra yeni veritabanında yeniden başlar. Siteleriniz sunulmaya devam eder. NPMpro tekrar yanıt verdiğinde sayfa yeniden yüklenir ve yeniden oturum açmanız gerekebilir.

Bir adım başarısız olursa NPMpro kullandığı veritabanında kalır ve pencere durduğu adı belirtir. Eski veritabanı hiçbir zaman silinmez; bu yüzden geri dönebilirsiniz: `/data/npmpro/database.json` dosyasını kaldırın ve konteyneri yeniden başlatın.

Bağlantı `DB_MYSQL_*` veya `DB_POSTGRES_*` değişkenlerinden geliyorsa bölüm salt okunurdur. Taşımak için bir yedek alın, değişkenleri yeni veritabanına yönlendirin, yeniden başlatın ve yedeği geri yükleyin.

Wiki'de devamı: Database.
