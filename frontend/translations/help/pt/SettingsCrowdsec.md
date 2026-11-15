## CrowdSec

Liga o bouncer do CrowdSec integrado no NPMpro ao seu contentor CrowdSec. Cada pedido aos seus anfitriões é verificado com as decisões da API local do CrowdSec (LAPI) e, com um URL do AppSec, com as regras do AppSec. Ao guardar, as definições são aplicadas de imediato com um recarregamento do nginx; o contentor não reinicia.

O NPMpro escreve `/data/crowdsec/crowdsec.conf` a partir destas definições. As alterações manuais a esse ficheiro são substituídas. As páginas de bloqueio e de captcha escolhem-se em **Definições**, **Páginas de destino**, onde também pode colar ou carregar uma página personalizada.

Uma variável definida no contentor prevalece sobre a interface e bloqueia o campo: `CROWDSEC_ENABLED`, `CROWDSEC_LAPI_URL`, `CROWDSEC_API_KEY`, `CROWDSEC_APPSEC_URL`.

### Estado e Testar ligação

Mostra se o nginx carrega o bouncer e quando o NPMpro contactou a LAPI pela última vez. **Testar ligação** verifica os valores do formulário: um pedido de decisões à LAPI com a chave (ou o certificado de cliente TLS) e, com um URL do AppSec, um pedido ao AppSec. Um campo de chave vazio usa a chave guardada.

Ao guardar com o bouncer ativo, o mesmo teste corre primeiro. Se falhar, os motivos são mostrados e **Guardar mesmo assim** guarda na mesma, por exemplo quando o CrowdSec ainda não está a correr.

**Guardar mesmo assim** não é oferecido quando o AppSec falha, **Quando não é possível aceder ao AppSec** está em **Recusar o pedido** e **Interface de administração e CrowdSec** está em **Verificada como todos os hosts**, porque esse guardar deixá-lo-ia sem acesso à interface de administração: corrija a **Chave de API** ou o **URL do AppSec**, defina a ação em caso de falha como **Deixar passar o pedido**, ou escolha **Apenas bloqueios** ou **Excluída** em **Interface de administração e CrowdSec**.

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
- **Interface de administração e CrowdSec**: **Verificada como todos os hosts** aplica bloqueios e AppSec à interface de administração. **Apenas bloqueios** aplica bloqueios e captchas mas não o AppSec, e uma falha do CrowdSec não o deixa sem acesso. **Excluída** não verifica nada. Ficou sem acesso por uma decisão de bloqueio ou de captcha? Veja **Ficou sem acesso?** mais abaixo.

### Captcha

O fornecedor (reCAPTCHA, hCaptcha, Cloudflare Turnstile), a sua chave do site e chave secreta, e durante quanto tempo um captcha resolvido continua válido. Usado para decisões do tipo captcha.

### AppSec

- **URL do AppSec**: por exemplo `http://127.0.0.1:7422`; vazio desativa o AppSec.
- **Quando não é possível aceder ao AppSec**: recusar bloqueia todos os pedidos verificados enquanto o AppSec estiver indisponível; deixar passar deixa-os sem verificação.

### Avançado

O tempo limite dos pedidos à LAPI, os filtros de cenários, os caminhos excluídos, os pedidos internos, e os tempos limite e opções do AppSec.

### Ficou sem acesso?

Uma decisão de bloqueio ou de captcha para o seu IP: execute `cscli decisions delete --ip <o seu IP>` no contentor do CrowdSec. Uma decisão de uma lista de bloqueio (a lista da comunidade ou uma lista da consola do CrowdSec) volta na próxima transferência, por isso adicione também o seu IP a uma allowlist (CrowdSec 1.6.6 ou mais recente): `cscli allowlists create npmpro-admins -d "admin IPs"` e depois `cscli allowlists add npmpro-admins <o seu IP>`.

O CrowdSec está em baixo: inicie-o novamente. Sem acesso ao CrowdSec: defina `CROWDSEC_ENABLED=false` no contentor e volte a criá-lo, escolha aqui **Excluída** para **Interface de administração e CrowdSec** (ou remova a decisão), corrija as definições e depois remova a variável e volte a criar o contentor.

Mais na wiki: CrowdSec.
