## Jurnallar və monitorinq

Jurnal faylları, GoAccess jurnal hesabatı və Monitorinq səhifəsinin arxasındakı trafik statistikası.

Konteynerdə təyin edilmiş dəyişən UI-dan üstündür və sahəni kilidləyir (sahədə "LOGROTATE ilə təyin edilib" kimi kilid nişanı və ya statistika üçün "Mühit tərəfindən təyin edilib" görünür). Konteynerdə təyin edilməyən hər şey üçün UI-dan istifadə edin. "Yenidən başlatma tələb olunur" ilə qeyd edilmiş parametrlər dərhal saxlanılır, lakin konteyner başlayanda oxunur; bölmə onları "Tətbiq etmək üçün konteyneri yenidən başladın" altında göstərir.

### Jurnal faylları

- **Jurnal fayllarını yaz**: nginx error, stream və access jurnallarını `/data/nginx/logs` qovluğuna yazır və gündəlik rotasiya edir. Standart: söndürülüb. Dəyişən: `LOGROTATE`. Saxlamanın işlətdiyi nginx reload-undan sonra tətbiq olunur. GoAccess işlədiyi müddətdə aktiv qalır.
- **Saxlanılan jurnal rotasiyaları**: ən köhnəsi silinməzdən əvvəl neçə rotasiya edilmiş jurnal faylının saxlanıldığı, 1-dən 1000-ə qədər. Standart: 3. Dəyişən: `LOGROTATIONS`. Dərhal tətbiq olunur.

### GoAccess

- **GoAccess hesabatı**: administratorlar üçün veb jurnal hesabatı olan GoAccess-i veb interfeysin `/goaccess` ünvanında işlədir. Standart: söndürülüb. Dəyişən: `GOA`. Konteyner yenidən başladıldıqdan sonra tətbiq olunur. O, trafik statistikasını aktiv etmir.

Hesabat aktiv olduqda bu seçimlər göstərilir. Hamısı konteyner yenidən başladıldıqdan sonra tətbiq olunur. Bir dəyişən, `GOACLA`, hamısını öz GoAccess seçimlərinizlə əvəz edir və onları kilidləyir.

- **Hesabat məlumatlarını saxla**: 1-dən 366 günə qədər. Standart: 30.
- **Ziyarətçi IP-lərini anonimləşdir**: Söndürülüb, Səviyyə 1 (standart), Səviyyə 2 (güclü) və ya Səviyyə 3 (dəqiq). Səviyyə 1 IPv4-ün son baytını (IPv6-nın son 64 bitini), səviyyə 2 iki baytı (80 bit), səviyyə 3 üç baytı (96 bit) gizlədir.
- **Sorğu sətirlərini at**: hesabatdakı URL-lərdən sorğu sətirlərini silir, beləliklə URL-lərdəki tokenlər saxlanılmır. Standart: aktiv.
- **Tam əməliyyat sistemi versiyaları**: yalnız ailəni deyil, tam versiyanı göstərir. Standart: aktiv.
- **Host adlarını müəyyən et**: ziyarətçi IP-lərinin host adlarını axtarır. Bu, onlar üçün DNS sorğuları göndərir. Standart: aktiv.

### Monitorinq

Bunlar Monitorinq səhifəsinin Trafik tabını idarə edir. Hamısı saxladıqda dərhal tətbiq olunur. Dəyişənlər: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Trafik statistikası**: nginx access jurnalını oxuyur və sorğuları host, status, ölkə və şəbəkə üzrə sayır. Standart: söndürülüb. Söndürmək yeni saymanı dayandırır; dialoqda "Saxlanılmış statistikanı da sil" seçməsəniz, saxlanılmış statistika köhnələnənə qədər qalır.
- **Statistikanı saxlama müddəti**: 7-dən 365 günə qədər. Standart: 30. Dəqiqəlik məlumat 24 saat, saatlıq məlumat bu qədər gün saxlanılır.
- **Ziyarətçi IP-lərini göstər**: ən çox rast gəlinən IP-ləri siyahıya almaq üçün ziyarətçi IP-lərini saatlıq saxlayır. Standart: məxfilik üçün söndürülüb. Söndürmək saxlanılmış IP-ləri silir.
- **Unikal ziyarətçiləri say**: unikal ziyarətçiləri saymaq üçün hər ziyarətçi IP-sinin açarlı heşini host və gün üzrə saxlayır. Standart: söndürülüb. Söndürmək heşləri silir.
- **Host və gün başına ziyarətçi limiti**: 1000-dən 1000000-a qədər. Standart: 100000. Ona çatan host həmin gün yeni ziyarətçiləri saymağı dayandırır və plus işarəsi göstərir.

Ölkələr və şəbəkələr GeoIP verilənlər bazaları tələb edir (Parametrlər, GeoIP).

Vikidə daha ətraflı: Monitoring.
