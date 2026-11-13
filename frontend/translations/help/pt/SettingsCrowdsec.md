## CrowdSec

Liga o bouncer do CrowdSec integrado no NPMpro ao seu contentor CrowdSec. Cada pedido aos seus anfitriões é verificado com as decisões da API local do CrowdSec (LAPI) e, com um URL do AppSec, com as regras do AppSec. Ao guardar, as definições são aplicadas de imediato com um recarregamento do nginx; o contentor não reinicia.

O NPMpro escreve `/data/crowdsec/crowdsec.conf` a partir destas definições. As alterações manuais a esse ficheiro são substituídas. As páginas de bloqueio e de captcha escolhem-se em **Definições**, **Páginas de destino**, onde também pode colar ou carregar uma página personalizada.

Uma variável definida no contentor prevalece sobre a interface e bloqueia o campo: `CROWDSEC_ENABLED`, `CROWDSEC_LAPI_URL`, `CROWDSEC_API_KEY`, `CROWDSEC_APPSEC_URL`.

### Estado e Testar ligação

Mostra se o nginx carrega o bouncer e quando o NPMpro contactou a LAPI pela última vez. **Testar ligação** verifica os valores do formulário: um pedido de decisões à LAPI com a chave (ou o certificado de cliente TLS) e, com um URL do AppSec, um pedido ao AppSec. Um campo de chave vazio usa a chave guardada.

Ao guardar com o bouncer ativo, o mesmo teste corre primeiro. Se falhar, os motivos são mostrados e **Guardar mesmo assim** guarda na mesma, por exemplo quando o CrowdSec ainda não está a correr.

**Guardar mesmo assim** não é oferecido quando o AppSec falha, **Quando não é possível aceder ao AppSec** está em **Recusar o pedido** e a interface de administração é verificada, porque esse guardar deixá-lo-ia sem acesso à interface de administração: corrija a **Chave de API** ou o **URL do AppSec**, defina a ação em caso de falha como **Deixar passar o pedido**, ou ative **Excluir a interface de administração do CrowdSec**.

### Ligação

- **Ativar o bouncer**: verifica cada pedido.
- **URL da LAPI**: por exemplo `http://127.0.0.1:8080`.
- **Chave de API**: de `docker exec crowdsec cscli bouncers add npmpro`. Guardada cifrada, nunca mais apresentada. **Remover a chave guardada** elimina-a.
- **Certificado de cliente TLS**: em vez da chave, um ficheiro de certificado e um de chave em `/data/crowdsec/`; requer um URL de LAPI com `https://`. Quando um URL do AppSec está definido, o campo **Chave de API** é mostrado e obrigatório também com um certificado de cliente TLS, porque o AppSec autentica-se com a chave de API; sem ela o AppSec recusa todos os pedidos.
- **Verificar certificados TLS**: verifica o certificado de um URL https da LAPI ou do AppSec.

### Bloqueio

- **Modo**: live consulta a LAPI por cada IP de cliente e guarda a resposta em cache durante os segundos indicados; stream transfere todas as decisões no intervalo indicado.
- **Resposta a um bloqueio**: a página de bloqueio (com um código de estado opcional, 403 por predefinição), um redirecionamento ou um código de estado sem página.
- **Medida alternativa** e **Tipos de decisão**: como são tratadas as decisões que o bouncer não consegue aplicar e quais os tipos aplicados.
- **Excluir a interface de administração do CrowdSec**: os pedidos à interface de administração ignoram o bouncer e o AppSec. Ative-o antes de usar o AppSec com recusar, para que uma falha do CrowdSec não o deixe sem acesso.

### Captcha

O fornecedor (reCAPTCHA, hCaptcha, Cloudflare Turnstile), a sua chave do site e chave secreta, e durante quanto tempo um captcha resolvido continua válido. Usado para decisões do tipo captcha.

### AppSec

- **URL do AppSec**: por exemplo `http://127.0.0.1:7422`; vazio desativa o AppSec.
- **Quando não é possível aceder ao AppSec**: recusar bloqueia todos os pedidos verificados enquanto o AppSec estiver indisponível; deixar passar deixa-os sem verificação.

### Avançado

O tempo limite dos pedidos à LAPI, os filtros de cenários, os caminhos excluídos, os pedidos internos, e os tempos limite e opções do AppSec.

### Ficou sem acesso?

Inicie o CrowdSec novamente, ou defina `CROWDSEC_ENABLED=false` no contentor e volte a criá-lo; depois corrija as definições aqui.

Mais na wiki: CrowdSec.
