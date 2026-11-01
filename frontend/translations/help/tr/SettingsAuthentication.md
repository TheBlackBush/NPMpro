## Kimlik doğrulama

NPMpro web arayüzüne bir OIDC sağlayıcısıyla (örneğin Authentik, Keycloak veya Google) parolalara ek olarak veya onların yerine oturum açma. Bu, iletilen kimlik doğrulama değildir: proxy host'larınızı korumaz. Bunun için Ayarlar, İletilen kimlik doğrulama bölümüne bakın.

Konteynerde ayarlanmış bir değişken arayüze üstün gelir ve alanı kilitler (alan "Ortam tarafından ayarlandı" gösterir). Dört bağlantı değişkeninin hepsi ayarlıysa OIDC, arayüzde etkinleştirilmeden etkindir. Konteynerde ayarlanmamış her şey için arayüzü kullanın. Buradaki her şey kaydettiğinizde uygulanır.

### Sağlayıcı

- **OIDC ile oturum açmayı etkinleştir**: oturum açma sayfasında oturum açma düğmesini gösterir.
- **Yayıncı URL'si**: sağlayıcının keşif (discovery) taban adresi, örneğin `https://accounts.example.com`. Değişken: `OIDC_ISSUER_URL`.
- **İstemci Kimliği** ve **İstemci gizli anahtarı**: sağlayıcınızdan alınır. Gizli anahtar şifrelenmiş olarak saklanır ve bir daha gösterilmez; korumak için boş bırakın. Yayıncı URL'sini veya istemci kimliğini değiştirirseniz gizli anahtarı yeniden girin. Değişkenler: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Yönlendirme alan adı**: insanların NPMpro'yu açmak için kullandığı alan adı, 443 değilse portuyla birlikte. Zorunludur, çünkü geri çağırma URL'sini oluşturur. Değişken: `OIDC_REDIRECT_DOMAIN`.
- **Geri çağırma URL'si**: salt okunur. Sağlayıcınızda yönlendirme URI'si olarak kaydedin.
- **Kapsamlar**: varsayılan `openid email profile`. Sağlayıcınız yalnızca bazılarına izin veriyorsa değiştirin, örneğin `openid email`.
- **Bağlantıyı test et**: NPMpro'nun yayıncıya ulaşıp ulaşamadığını denetler.

### Oturum açma düğmesi

Oturum açma sayfasındaki düğme: **Görünen ad** ("Şununla oturum aç" sonrasındaki metin), **Renk** (hazır bir renk veya kendi `#rrggbb` değeriniz) ve **Simge** (yerleşik, PNG, JPEG, WebP veya SVG olarak 256 KB'a kadar yüklenmiş ya da bir URL'den indirilmiş). Bir önizleme gösterilir.

### Oturum açma kuralları

- **Doğrulanmış e-posta iste**: sağlayıcısı e-postasını doğrulamamış kullanıcıları reddeder. Varsayılan: açık. Değişken: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **OIDC sonrasında iki adımlı doğrulamayı atla**: sağlayıcının kendi çok faktörlü denetimine güvenir. Varsayılan: kapalı. Değişken: `OIDC_SKIP_MFA`.
- **Parolayla girişi devre dışı bırak**: yalnızca OIDC ile oturum açılabilir. Bunu yalnızca OIDC ile açılmış bir oturumdan açabilirsiniz. Değişken: `OIDC_DISABLE_PASSWORD`; parolayla girişi geri getirmek için `false` yapın ve konteyneri yeniden oluşturun.

### Yeni kullanıcılar

- **Kullanıcıları ilk oturum açışlarında oluştur** (varsayılan: kapalı): hesabı olmayan bir kişi, aşağıdaki izinlerle bir hesap alır.
- **İzin verilen e-posta alan adları**: virgülle ayrılır; boş olması her alan adına izin verir. Liste boşsa ve doğrulanmış e-posta gerekmiyorsa, sağlayıcınızın kabul ettiği herkes bir hesap alır.
- **Yeni kullanıcılar için varsayılan izinler**: bölüm başına ayarlanır. Yeni kullanıcılar asla yönetici olmaz.

Wiki'de devamı: Authentication.
