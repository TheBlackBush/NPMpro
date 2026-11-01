## Yönləndirilmiş autentifikasiya

Yönləndirilmiş autentifikasiya proksi hostun qarşısına giriş və ya bot yoxlaması qoyur. Hər sorğu üçün nginx əvvəlcə autentifikasiya xidmətindən ziyarətçinin keçə bilib-bilməyəcəyini soruşur. NPMpro-da bu, Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia və Authentik üçün daxili var. Provayderi öz konteynerində işlədirsiniz.

Bu səhifə hər provayderin standart ünvanını (upstream) təyin edir. Proksi host yoxlamanı Təfərrüatlar tabındakı Seçimlər altında **Auth Request** ilə (və ya fərdi məkanda) aktiv edir.

Konteynerdə təyin edilmiş dəyişən UI-dan üstündür və sahəni kilidləyir (sahədə "AUTH_REQUEST_AUTHELIA_UPSTREAM ilə təyin edilib" kimi kilid nişanı görünür). Konteynerdə təyin edilməyən hər şey üçün UI-dan istifadə edin. Buradakı hər parametr saxlamanın işlətdiyi nginx reload-undan sonra tətbiq olunur. nginx testi uğursuz olarsa, heç nə saxlanmır.

### Standart upstream-lər

- **Anubis upstream**, **Tinyauth upstream**, **OAuth2 Proxy upstream**, **VoidAuth upstream**, **Authelia upstream**, **Authentik upstream**: həmin provayderi istifadə edən və öz upstream-i olmayan proksi hostlar tərəfindən istifadə olunur. Hostun öz dəyəri üstündür. Standart: boş (yoxdur). Dəyişənlər: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Format: `scheme://host:port`, məsələn `http://127.0.0.1:9091`, və ya adı `cu_` ilə başlayan öz nginx upstream blokunuz üçün `scheme://cu_name`. `http` və ya `https` istifadə edin; port məcburidir; IPv6 ünvanı mötərizədə yazılır. Yol, boşluq və `; { } # " ' $ \` simvollarından heç biri olmamalıdır.

Proksi hostlar həmin provayderi öz upstream-i olmadan istifadə edərkən standartı boşalda bilməzsiniz. Mesaj həmin hostları siyahıya alır.

Provayderi istifadə edən, amma heç yerdə upstream-i olmayan host "Konfiqurasiya xətası" alır.

### Anubis

- **Fərdi Anubis şəkilləri**: Anubis challenge səhifələrində öz `happy.webp`, `reject.webp` və `pensive.webp` şəkillərinizi göstərir. Standart: üç fayl da mövcud və boş olmadıqda aktiv, əks halda söndürülüb. Dəyişən: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. Şəkillər data qovluğunuzda `public/anubis` içinə qoyulur.

Vikidə daha ətraflı: Forward-Authentication.
