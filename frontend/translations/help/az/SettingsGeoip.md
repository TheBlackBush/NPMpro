## GeoIP

NPMpro pulsuz MaxMind GeoLite2 verilənlər bazalarını özü endirir və ölkələri və şəbəkələri serverinizdə axtarır, buna görə ziyarətçi IP-ləri heç vaxt heç yerə göndərilmir. Ayrıca geoipupdate konteynerinə ehtiyacınız yoxdur. Verilənlər bazaları Monitorinq xəritəsini və siyahılarını, GoAccess-i və nginx ölkə qaydalarını qidalandırır.

Konteynerdə təyin edilmiş dəyişən UI-dan üstündür və sahəni kilidləyir (sahədə "Mühit tərəfindən təyin edilib" yazılır). Konteynerdə təyin edilməyən hər şey üçün UI-dan istifadə edin. Saxlamaq yükləməni arxa planda başladır və aşağıdakı status bitəndə yenilənir.

### MaxMind hesabı

Pulsuz MaxMind hesabı və lisenziya açarı lazımdır (MaxMind-də: Account, Manage license keys). Səhifədə qeydiyyat keçidi var.

- **Hesab ID-si**: dəyişən `GEOIP_ACCOUNT_ID`.
- **Lisenziya açarı**: şifrələnmiş saxlanılır və bir daha göstərilmir. Saxlanılmış açarın şifrəsini açmaq mümkün deyilsə, onu yenidən daxil edin. Dəyişən: `GEOIP_LICENSE_KEY`.

### Verilənlər bazaları

- **GeoLite2 Country**: xəritə, ölkə siyahıları və nginx ölkə qaydaları üçün ölkələr. Standart olaraq aktiv.
- **GeoLite2 ASN**: şəbəkə siyahıları üçün şəbəkələr (AS nömrəsi və adı). Standart olaraq aktiv.
- **GeoLite2 City**: ixtiyari, GoAccess üçün şəhərlər. Daha böyük yükləmə. Standart olaraq söndürülüb.

Dəyişən: `GEOIP_EDITIONS`, boşluqla ayrılır, məsələn `GeoLite2-Country GeoLite2-ASN`. Heç bir verilənlər bazası seçilməyibsə, heç nə endirilmir və ya yenilənmir, əvvəlcədən endirilmiş verilənlər bazaları isə saxlanılır.

### Status

Son yeniləməni və son xətanı göstərir. NPMpro verilənlər bazalarını hesabı və ya verilənlər bazalarını dəyişdikdə, **İndi yenilə** düyməsinə basdıqda və hər 3 gündən bir avtomatik yeniləyir. Uğursuz avtomatik yeniləmə 24 saatdan sonra yenidən sınanır. **İndi yenilə** saxlanılmış hesab ID-si və lisenziya açarı tələb edir.

Verilənlər bazaları olmadan xəritə və ölkə və şəbəkə siyahıları gizlədilir; qalan hər şey işləyir.

Vikidə daha ətraflı: Monitoring.
