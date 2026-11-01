## Standart sayt

Standart sayt, ziyarətçi NPMpro-ya heç bir hostun istifadə etmədiyi host adı ilə və ya serverin IP ünvanı ilə gəldikdə nginx-in verdiyi cavabdır. Cavabı burada seçin. O, bütün naməlum adlara tətbiq olunur.

Saxlamaq yeni seçimi əvvəlcə nginx ilə yoxlayır. Test uğursuz olarsa, heç nə saxlanmır, əvvəlki standart sayt qalır və nginx xətası konteyner jurnalındadır.

- **Təbriklər səhifəsi** (standart): NPMpro xoş gəldiniz səhifəsini göstərir.
- **404 səhifəsi**: 404 Not Found səhifəsi ilə cavab verir.
- **Cavab yoxdur (444)**: bağlantını heç bir cavab vermədən bağlayır. Skanerlərə göstəriləcək heç nə verməmək üçün istifadə edin. Naməlum adlar üçün HTTPS sorğuları TLS əl sıxması zamanı rədd edilir.
- **Yönləndirmə**: ziyarətçiləri müvəqqəti yönləndirmə (302) ilə başqa ünvana göndərir. Boşluq, dırnaq və ya `; { } #` olmayan tam `http://` və ya `https://` URL-i daxil edin, 255 simvola qədər.
- **Fərdi HTML**: öz HTML səhifənizi göstərir. Altındakı **HTTP Status Code** ixtiyaridir, 400-dən 599-a qədər. 200 (OK) üçün boş buraxın.

Cavab yoxdur istisna olmaqla hər seçim üçün naməlum adlara düz HTTP ilə sorğular əvvəlcə HTTPS-ə yönləndirilir, HTTPS sorğuları isə Parametrlər, Sertifikatlar və TLS bölməsində **Standart sertifikat** kimi seçilmiş sertifikatdan istifadə edir.

Bu bölmənin mühit dəyişənləri yoxdur, buna görə dəyişiklik saxladıqda tətbiq olunur.
