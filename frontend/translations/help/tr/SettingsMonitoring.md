## Günlükler ve izleme

Günlük dosyaları, GoAccess günlük raporu ve İzleme sayfasının arkasındaki trafik istatistikleri.

Konteynerde ayarlanmış bir değişken arayüze üstün gelir ve alanı kilitler (alan, "LOGROTATE tarafından ayarlandı" gibi bir kilit rozeti ya da istatistikler için "Ortam tarafından ayarlandı" gösterir). Konteynerde ayarlanmamış her şey için arayüzü kullanın. "Yeniden başlatma gerekli" olarak işaretlenen ayarlar hemen kaydedilir ancak konteyner başlarken okunur; bölüm bunları o zaman "Uygulamak için konteyneri yeniden başlatın" altında listeler.

### Günlük dosyaları

- **Günlük dosyalarını yaz**: nginx hata, akış ve erişim günlüklerini `/data/nginx/logs` içine yazar ve günlük olarak döndürür. Varsayılan: kapalı. Değişken: `LOGROTATE`. Kaydetmenin çalıştırdığı nginx yeniden yüklemesinden sonra uygulanır. GoAccess çalışırken açık kalır.
- **Saklanan günlük döngüleri**: en eskisi silinmeden önce kaç döndürülmüş günlük dosyasının saklanacağı, 1 ila 1000. Varsayılan: 3. Değişken: `LOGROTATIONS`. Hemen uygulanır.

### GoAccess

- **GoAccess raporu**: web arayüzünün `/goaccess` altında, yöneticiler için bir web günlüğü raporu olan GoAccess'i çalıştırır. Varsayılan: kapalı. Değişken: `GOA`. Konteyner yeniden başlatıldıktan sonra uygulanır. Trafik istatistiklerini açmaz.

Rapor açıkken şu seçenekler görünür. Hepsi konteyner yeniden başlatıldıktan sonra uygulanır. Tek bir değişken, `GOACLA`, hepsini kendi GoAccess seçeneklerinizle değiştirir ve onları kilitler.

- **Rapor verilerini sakla**: 1 ila 366 gün. Varsayılan: 30.
- **Ziyaretçi IP'lerini anonimleştir**: Kapalı, Düzey 1 (varsayılan), Düzey 2 (güçlü) veya Düzey 3 (titiz). Düzey 1 IPv4'ün son baytını (IPv6'nın son 64 bitini), düzey 2 iki baytı (80 bit), düzey 3 üç baytı (96 bit) gizler.
- **Sorgu dizelerini çıkar**: rapordaki URL'lerden sorgu dizelerini kaldırır, böylece URL'lerdeki belirteçler saklanmaz. Varsayılan: açık.
- **Tam işletim sistemi sürümleri**: yalnızca ailesini değil, tam sürümü gösterir. Varsayılan: açık.
- **Host adlarını çözümle**: ziyaretçi IP'lerinin host adlarını arar. Bunun için DNS sorguları gönderilir. Varsayılan: açık.

### İzleme

Bunlar İzleme sayfasının Trafik sekmesini denetler. Hepsi kaydedildiğinde hemen uygulanır. Değişkenler: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Trafik istatistikleri**: nginx erişim günlüğünü okur ve istekleri host, durum, ülke ve ağ başına sayar. Varsayılan: kapalı. Kapatmak yeni saymayı durdurur; iletişim kutusunda "Saklanan istatistikleri de sil"i işaretlemediğiniz sürece saklanan istatistikler eskiyene kadar kalır.
- **İstatistikleri sakla**: 7 ila 365 gün. Varsayılan: 30. Dakika başına veriler 24 saat, saatlik veriler bu kadar gün saklanır.
- **Ziyaretçi IP'lerini göster**: en çok görünen IP'leri listelemek için ziyaretçi IP'lerini saat başına saklar. Varsayılan: gizlilik için kapalı. Kapatmak saklanan IP'leri siler.
- **Tekil ziyaretçileri say**: tekil ziyaretçileri saymak için her ziyaretçi IP'sinin host ve gün başına anahtarlı bir hash'ini saklar. Varsayılan: kapalı. Kapatmak hash'leri siler.
- **Host ve gün başına ziyaretçi sınırı**: 1000 ila 1000000. Varsayılan: 100000. Sınıra ulaşan bir host o gün yeni ziyaretçileri saymayı bırakır ve artı işareti gösterir.

Ülkeler ve ağlar GeoIP veritabanlarını gerektirir (Ayarlar, GeoIP).

Wiki'de devamı: Monitoring.
