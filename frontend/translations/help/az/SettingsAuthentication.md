## Autentifikasiya

NPMpro veb interfeysinə OIDC provayderi (məsələn Authentik, Keycloak və ya Google) ilə, parolların yanında və ya əvəzinə giriş. Bu, yönləndirilmiş autentifikasiya deyil: proksi hostlarınızı qorumur. Bunun üçün Parametrlər, Yönləndirilmiş autentifikasiya bölməsinə baxın.

Konteynerdə təyin edilmiş dəyişən UI-dan üstündür və sahəni kilidləyir (sahədə "Mühit tərəfindən təyin edilib" yazılır). Dörd bağlantı dəyişəninin hamısı təyin edilibsə, OIDC UI-da aktiv edilmədən işləyir. Konteynerdə təyin edilməyən hər şey üçün UI-dan istifadə edin. Burada hər şey saxladıqda tətbiq olunur.

### Provayder

- **OIDC girişini aktiv et**: giriş səhifəsində giriş düyməsini göstərir.
- **Issuer URL**: provayderin discovery əsas ünvanı, məsələn `https://accounts.example.com`. Dəyişən: `OIDC_ISSUER_URL`.
- **Client ID** və **Client secret**: provayderinizdən. Secret şifrələnmiş saxlanılır və bir daha göstərilmir; saxlamaq üçün onu boş buraxın. Issuer URL və ya client ID dəyişsəniz, secret-i yenidən daxil edin. Dəyişənlər: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Yönləndirmə domeni**: insanların NPMpro-nu açmaq üçün istifadə etdiyi domen, port 443 deyilsə, portla birlikdə. Məcburidir, çünki callback URL-ni o qurur. Dəyişən: `OIDC_REDIRECT_DOMAIN`.
- **Callback URL**: yalnız oxumaq üçün. Onu provayderinizdə redirect URI kimi qeydiyyatdan keçirin.
- **Scope-lar**: standart `openid email profile`. Provayderiniz yalnız bəzilərinə icazə verirsə dəyişin, məsələn `openid email`.
- **Bağlantını yoxla**: NPMpro-nun issuer-ə çata bildiyini yoxlayır.

### Giriş düyməsi

Giriş səhifəsindəki düymə: **Göstərilən ad** ("ilə daxil ol" sözündən əvvəlki mətn), **Rəng** (hazır seçim və ya sizin `#rrggbb` dəyəriniz) və **İkon** (daxili, PNG, JPEG, WebP və ya SVG kimi 256 KB-a qədər yüklənmiş və ya URL-dən endirilmiş). Önizləmə göstərilir.

### Giriş qaydaları

- **Təsdiqlənmiş e-poçt tələb et**: provayderi e-poçtunu təsdiqləməyən istifadəçiləri rədd edir. Standart: aktiv. Dəyişən: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **OIDC-dən sonra iki faktorlu yoxlamanı ötür**: provayderin öz çoxfaktorlu yoxlamasına etibar edir. Standart: söndürülüb. Dəyişən: `OIDC_SKIP_MFA`.
- **Parolla girişi söndür**: yalnız OIDC ilə daxil olmaq olar. Bunu yalnız OIDC ilə daxil olmuş sessiyadan aktiv edə bilərsiniz. Dəyişən: `OIDC_DISABLE_PASSWORD`; parolla girişi bərpa etmək üçün onu `false` təyin edin və konteyneri yenidən yaradın.

### Yeni istifadəçilər

- **İstifadəçiləri ilk girişdə yarat** (standart: söndürülüb): hesabı olmayan şəxs aşağıdakı icazələrlə hesab alır.
- **İcazə verilən e-poçt domenləri**: vergüllə ayrılır; boş olduqda istənilən domenə icazə verilir. Siyahı boşdursa və təsdiqlənmiş e-poçt tələb olunmursa, provayderinizin qəbul etdiyi hər kəs hesab alır.
- **Yeni istifadəçilər üçün standart icazələr**: hər bölmə üçün təyin edilir. Yeni istifadəçilər heç vaxt administrator olmur.

Vikidə daha ətraflı: Authentication.
