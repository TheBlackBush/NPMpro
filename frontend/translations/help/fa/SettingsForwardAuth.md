## احراز هویت ارجاعی

احراز هویت ارجاعی یک ورود یا بررسی ربات را جلوی یک میزبان پراکسی می‌گذارد. برای هر درخواست، nginx ابتدا از یک سرویس احراز هویت می‌پرسد که آیا بازدیدکننده اجازه عبور دارد. NPMpro آن را برای Anubis، Tinyauth، OAuth2 Proxy، VoidAuth، Authelia و Authentik داخلی دارد. ارائه‌دهنده را در کانتینر خودش اجرا می‌کنید.

این صفحه نشانی پیش‌فرض (upstream) هر ارائه‌دهنده را تعیین می‌کند. یک میزبان پراکسی بررسی را با **Auth Request** زیر گزینه‌ها در تب جزئیات خود (یا روی یک مسیر سفارشی) روشن می‌کند.

متغیری که روی کانتینر تنظیم شده باشد بر UI برتری دارد و فیلد را قفل می‌کند (فیلد یک نشان قفل مانند «تنظیم‌شده توسط AUTH_REQUEST_AUTHELIA_UPSTREAM» نشان می‌دهد). برای هر چیزی که در کانتینر تنظیم نشده از UI استفاده کنید. هر تنظیم اینجا پس از reload nginx که ذخیره اجرا می‌کند اعمال می‌شود. اگر آزمایش nginx شکست بخورد، چیزی ذخیره نمی‌شود.

### Upstreamهای پیش‌فرض

- **Upstream مربوط به Anubis**، **Upstream مربوط به Tinyauth**، **Upstream مربوط به OAuth2 Proxy**، **Upstream مربوط به VoidAuth**، **Upstream مربوط به Authelia**، **Upstream مربوط به Authentik**: توسط میزبان‌های پراکسی با آن ارائه‌دهنده که upstream خودشان را ندارند استفاده می‌شود. مقدار خود میزبان برتری دارد. پیش‌فرض: خالی (هیچ). متغیرها: `AUTH_REQUEST_ANUBIS_UPSTREAM`، `AUTH_REQUEST_TINYAUTH_UPSTREAM`، `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`، `AUTH_REQUEST_VOIDAUTH_UPSTREAM`، `AUTH_REQUEST_AUTHELIA_UPSTREAM`، `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

قالب: `scheme://host:port`، مثلاً `http://127.0.0.1:9091`، یا `scheme://cu_name` برای بلوک upstream nginx خودتان که نامش با `cu_` شروع می‌شود. از `http` یا `https` استفاده کنید؛ پورت الزامی است؛ نشانی IPv6 در کروشه می‌آید. بدون path، بدون فاصله و بدون هیچ‌یک از `; { } # " ' $ \`.

تا وقتی میزبان‌های پراکسی از آن ارائه‌دهنده بدون upstream خودشان استفاده می‌کنند نمی‌توانید پیش‌فرض را خالی کنید. پیام آن میزبان‌ها را فهرست می‌کند.

میزبانی که از ارائه‌دهنده‌ای استفاده می‌کند که هیچ‌جا upstream ندارد «خطای پیکربندی» می‌گیرد.

### Anubis

- **تصاویر سفارشی Anubis**: `happy.webp`، `reject.webp` و `pensive.webp` خودتان را در صفحات چالش Anubis نشان می‌دهد. پیش‌فرض: وقتی هر سه فایل وجود داشته باشند و خالی نباشند روشن، در غیر این صورت خاموش. متغیر: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. تصاویر در `public/anubis` در پوشه داده شما قرار می‌گیرند.

بیشتر در ویکی: Forward-Authentication.
