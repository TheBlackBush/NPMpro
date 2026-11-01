## Yönləndirmə hostu nədir?

Yönləndirmə hostu bir domenin ziyarətçilərini başqa ünvana göndərir. Sayt domen dəyişdikdə və köhnə keçidlər işləməyə davam etməli olduqda və ya `www` ünvanını əsas ada yönləndirmək üçün istifadə edin.

Hostu yeni Əlavə et pəncərəsinə kopyalamaq üçün hostun menyusunda **Klonla** seçin. Kopya domen adları olmadan başlayır, çünki bir domen yalnız bir aktiv hosta aid ola bilər.

### Təfərrüatlar

- **Domen adları**: yönləndirilən adlar. Məcburidir. Wildcard-lara yeni sertifikat üçün yalnız DNS challenge ilə icazə verilir.
- **Sxem**: hədəfin sxemi. "saxla (sorğu ilə eyni)" standartdır və ziyarətdəki `http` və ya `https` sxemini saxlayır. Yaxud `http` və ya `https` seçin.
- **Yönləndirmə domeni**: ziyarətçilərin göndərildiyi domen, məsələn `example.com`. Məcburidir.
- **HTTP kodu**: cavab kodu. Standart 301 Moved permanently. Digər seçimlər: 302 Moved temporarily, 303 See other, 307 Temporary redirect və 308 Permanent redirect. Köçürmə həmişəlik olduqda 301 və ya 308 istifadə edin; brauzerlər və axtarış sistemləri onları yadda saxlayır.
- **Qrup**: uzun siyahıları səliqəli saxlayan sərbəst etiket. İstifadədə olanı seçin və ya yeni ad yazın.
- **Yolu saxla** (standart olaraq söndürülüb): ilkin yolu və sorğunu hədəfə əlavə edir. Aktiv olduqda `old.example/a?b=1` ünvanı `new.example/a?b=1` ünvanına gedir. Söndürülübsə, hər ziyarətçi hədəfin əvvəlinə düşür.

### TLS

- **TLS sertifikatı**: Yoxdur, Yeni sertifikat tələb et və ya mövcud sertifikat. Aşağıdakı seçimlər sertifikat tələb edir.
- **mTLS sertifikatı**: klient sertifikat orqanı. **mTLS-i isteğe bağlı et** klient sertifikatı olmayan ziyarətçilərə giriş verir.
- **HTTPS-i məcburi et**: əvvəlcə HTTP-ni HTTPS-ə yönləndirir.
- **HTTP/3 dəstəyi**: HTTP/3-ə (QUIC) icazə verir.
- **HSTS aktivdir (2 il)**: HTTPS-i məcburi etməyi tələb edir. **HSTS alt domenlər+Preload** HSTS tələb edir.
- Yeni sertifikat üçün: **Açarı təkrar istifadə et (tövsiyə edilmir)** və **DNS Challenge-dən istifadə et**, provayder, etibarnamə və yayılma saniyələri ilə.

Bütün TLS seçimləri standart olaraq söndürülüb.

### Əlavə

Hostun server blokunun daxilinə əlavə olunan fərdi nginx konfiqurasiyası. Yalnız administratorlar dəyişə bilər; digər istifadəçilər onu yalnız oxuya bilər.

Vikidə daha ətraflı: Host options.
