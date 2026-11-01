## GeoIP

NPMpro ücretsiz MaxMind GeoLite2 veritabanlarını kendisi indirir ve ülkeleri ve ağları sunucunuzda arar; bu yüzden ziyaretçi IP'leri hiçbir yere gönderilmez. Ayrı bir geoipupdate konteynerine ihtiyacınız yoktur. Veritabanları İzleme haritasını ve listelerini, GoAccess'i ve nginx ülke kurallarını besler.

Konteynerde ayarlanmış bir değişken arayüze üstün gelir ve alanı kilitler (alan "Ortam tarafından ayarlandı" gösterir). Konteynerde ayarlanmamış her şey için arayüzü kullanın. Kaydetmek indirmeyi arka planda başlatır ve aşağıdaki durum bittiğinde güncellenir.

### MaxMind hesabı

Ücretsiz bir MaxMind hesabına ve bir lisans anahtarına ihtiyacınız var (MaxMind'da: Account, Manage license keys). Sayfada bir kayıt bağlantısı vardır.

- **Hesap Kimliği**: değişken `GEOIP_ACCOUNT_ID`.
- **Lisans anahtarı**: şifrelenmiş olarak saklanır ve bir daha gösterilmez. Kayıtlı anahtarın şifresi çözülemezse yeniden girin. Değişken: `GEOIP_LICENSE_KEY`.

### Veritabanları

- **GeoLite2 Country**: harita, ülke listeleri ve nginx ülke kuralları için ülkeler. Varsayılan olarak açık.
- **GeoLite2 ASN**: ağ listeleri için ağlar (AS numarası ve adı). Varsayılan olarak açık.
- **GeoLite2 City**: isteğe bağlı, GoAccess için şehirler. Çok daha büyük bir indirme. Varsayılan olarak kapalı.

Değişken: `GEOIP_EDITIONS`, boşlukla ayrılmış, örneğin `GeoLite2-Country GeoLite2-ASN`. Hiç veritabanı seçilmezse hiçbir şey indirilmez veya güncellenmez; önceden indirilmiş veritabanları korunur.

### Durum

Son güncellemeyi ve son hatayı gösterir. NPMpro, hesabı veya veritabanlarını değiştirdiğinizde, **Şimdi güncelle**'ye tıkladığınızda ve otomatik olarak her 3 günde bir veritabanlarını günceller. Başarısız bir otomatik güncelleme 24 saat sonra yeniden denenir. **Şimdi güncelle** için kayıtlı bir hesap kimliği ve lisans anahtarı gerekir.

Veritabanı yoksa harita ile ülke ve ağ listeleri gizlenir; geri kalan çalışır.

Wiki'de devamı: Monitoring.
