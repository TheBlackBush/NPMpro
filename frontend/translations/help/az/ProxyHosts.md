## Proksi host nədir?

Proksi host veb xidmətin giriş qapısıdır. Ziyarətçilər domeninizi NPMpro-da açır, NPMpro isə sorğunu arxadakı xidmətə ötürür. O, öz TLS-i (HTTPS) olmayan xidmətlərə də TLS əlavə edə bilər. Proksi hostlar NPMpro-nun ən geniş yayılmış istifadəsidir.

Hostu yeni Əlavə et pəncərəsinə kopyalamaq üçün hostun menyusunda **Klonla** seçin. Kopya domen adları olmadan başlayır, çünki bir domen yalnız bir aktiv hosta aid ola bilər.

### Təfərrüatlar

- **Domen adları**: ziyarətçilərin istifadə etdiyi adlar. Məcburidir. Yeni sertifikat üçün wildcard-lar (`*.example.com`) DNS challenge tələb edir.
- **Sxem**: NPMpro-nun xidmətlə necə əlaqə qurduğu: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (qovluqdan fayl və ya PHP təqdim edir) və ya `empty` (upstream yoxdur). Standart `http://`. Sxemin dəyişdirilməsi ona uyğun olmayan seçimləri söndürür.
- **Yönləndirmə host adı / IP / yol**: xidmətin ünvanı. Alt yol əlavə edə bilərsiniz, məsələn `127.0.0.1/path`. `path` ilə qovluq daxil edin. Fayllarınızı `/var/www` altına qoşun; bundan kənar qovluğu yalnız administratorlar istifadə edə bilər. `cu_` ilə başlayan ad sizin öz nginx upstream blokunuza işarə edir (vikidə Load balancing bölməsinə baxın).
- **Yönləndirmə portu**: ixtiyaridir. `path` ilə bu, PHP versiyasıdır.
- **Qrup**: uzun siyahıları səliqəli saxlayan sərbəst etiket.
- **Seçimlər** (hamısı standart olaraq söndürülüb):
  - **noindex başlığı göndər və bəzi bot user agent-lərini blokla**: axtarış sistemlərindən saytı indekslməməyi xahiş edir və bəzi krouleri bloklayır.
  - **CrowdSec AppSec-i söndür**: CrowdSec AppSec-i yalnız bu host üçün söndürür. Yalnız AppSec qurulubsa təsir edir.
  - **Sorğu buferləşdirməsini söndür** və **Cavab buferləşdirməsini söndür**: http və https upstream-lər üçün. Sürətli və sabit bağlantı üzərindən axın ötürmürsünüzsə və ya böyük fayllar yükləmirsinizsə, buferləşməni açıq saxlayın. Sorğu buferləşdirməsinin söndürülməsi AppSec-i də söndürür.
  - **Upstream tərəfindən sıxılmanı aktiv et**: xidmətə öz cavablarını özünün sıxmasına imkan verir. Xidmətə lazım deyilsə, söndürülmüş saxlayın. `path` və `empty` üçün deyil.
  - **fancyindex-i aktiv et**: qovluqda index faylı olmadıqda fayl siyahısı göstərir. Yalnız `path` üçün.
- **X-Frame-Options**: `SAMEORIGIN` (standart), `DENY`, `none` (başlığı silir) və ya `upstream` (xidmətin göndərdiyini saxlayır).
- **Auth Request**: hostun qarşısına giriş və ya bot yoxlaması qoyur (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Standart `none`. **Auth Request upstream** ixtiyaridir; boş olduqda Parametrlər, Yönləndirilmiş autentifikasiya bölməsindəki standart istifadə olunur.
- **Qlobal giriş siyahıları**: **İctimai əlçatan** (standart, girişsiz) və ya **Fərdi**, bir və ya bir neçə giriş siyahısı.

Websocket-lər həmişə aktivdir.

### Fərdi məkanlar

Məkan hostun bir yolunu (məsələn `/api/`) başqa xidmətə göndərir. Hər birində **Aktiv edildi**, istəyə görə uyğunluq növü (`=`, `~`, `~*`, `^~` və ya `@`) olan yol, öz sxemi, hostu, portu, seçimləri, Auth Request-i və giriş siyahıları var. Onun giriş siyahısı hostun siyahılarını istifadə edən **Qlobal** ola bilər. O, hostun Auth Request-ini miras almır. Prefiks uyğunluğu istəmirsinizsə, yolun sonuna kəsr xətti əlavə edin. Administratorlar dişli düyməsi ilə hər məkan üçün fərdi nginx konfiqurasiyası əlavə edə bilər.

### TLS

- **TLS sertifikatı**: Yoxdur, Yeni sertifikat tələb et və ya mövcud sertifikat. Aşağıdakı seçimlər sertifikat tələb edir.
- **mTLS sertifikatı**: klient sertifikat orqanı. **mTLS-i isteğe bağlı et** sertifikatı olmayan ziyarətçilərə giriş verir. **mTLS Auth Request-i keçir** etibarlı sertifikatı olan ziyarətçilərin Auth Request-i keçməsinə imkan verir.
- **HTTPS-i məcburi et** HTTP-ni HTTPS-ə yönləndirir. **HTTP/3 dəstəyi** HTTP/3-ə (QUIC) icazə verir.
- **HSTS aktivdir (2 il)**: HTTPS-i məcburi etməyi tələb edir. **HSTS alt domenlər+Preload** HSTS tələb edir.
- Yeni sertifikat üçün: **Açarı təkrar istifadə et (tövsiyə edilmir)** və **DNS Challenge-dən istifadə et**, provayder, etibarnamə və yayılma saniyələri ilə.

### Əlavə

Bütün host (server bloku) və əsas məkan `location /` üçün fərdi nginx konfiqurasiyası. Yalnız administratorlar dəyişə bilər.

Vikidə daha ətraflı: Host options.
