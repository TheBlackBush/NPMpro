# PHP

NPMpro can serve PHP in two ways: through an external php-fpm (recommended) or through the php-fpm built into the image (not recommended).

## Use of external php-fpm (recommended)
To set it per location: press the gear button, set the scheme to `path`, put in the path and paste the following in the new text field at the bottom, you need to adjust the last line:
```
location ~* [^/]\.php(?:$|/) {
  fastcgi_split_path_info ^(.*\.php)(/.*)$;
  try_files $fastcgi_script_name =404;
  fastcgi_pass ...; # set this to the address of your php-fpm (socket/tcp): https://nginx.org/en/docs/http/ngx_http_fastcgi_module.html#fastcgi_pass
}
```

## Use of inbuilt php-fpm (not recommended)
1. First enable php inside your compose file (you can add more php extension using envs in the compose file)
2. Set the forwarding port to the php version you want to use and is supported by NPMpro (like 83/84/85)
3. `session.upload_progress.enabled` is off (mitigation for the upload progress bugs CVE-2026-109618 and CVE-2026-109619, kept as defence in depth after the PHP fix, `/data/php/<version>/conf.d/00-npmpro.ini`, rewritten at every start). To turn it on again, set it in a later file of that folder, for example `zz-local.ini`.
4. Extra `fastcgi_param` lines (for example `fastcgi_param PHP_VALUE "upload_max_filesize=64M";`) go into `custom_nginx/php.conf`: it is included in every PHP location of the built-in php-fpm. `fastcgi_param` lines in a host's advanced config do not reach PHP, because the PHP location sets its own parameters (`PATH_INFO`, and with an access list without pass auth an empty `HTTP_AUTHORIZATION`).
