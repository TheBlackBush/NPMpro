## Certificados e TLS

Predefinições para os certificados que o NPMpro pede ao seu servidor ACME (Let's Encrypt, a não ser que defina outro com `ACME_SERVER`), para a forma como são agrafados (stapling) e renovados, e para o certificado que responde por hosts desconhecidos. Esta é a secção das Definições, não a página da lista de Certificados.

Uma variável definida no contentor tem prioridade sobre a interface e bloqueia o campo (o campo mostra um selo com cadeado, como "Definido por ACME_KEY_TYPE"). Alguns campos seguem outro: um `ACME_KEY_SIZE` isolado que seja uma curva ECDSA mantém o tipo de chave em ECDSA, e o Must-Staple mantém o OCSP stapling ativo. Use a interface para tudo o que não esteja definido no contentor.

### Pedidos de certificado

Aplicam-se a partir do próximo pedido de certificado.

- **Tipo de chave**: `ECDSA` (predefinição, recomendado: chaves mais pequenas, handshakes mais rápidos) ou `RSA` para clientes que não conseguem usar ECDSA. Variável: `ACME_KEY_TYPE`.
- **Tamanho da chave**: a curva para ECDSA (`secp256r1`, `secp384r1`, `secp521r1`; predefinição `secp384r1`) ou os bits para RSA (`2048`, `3072`, `4096`; predefinição `4096`). Variável: `ACME_KEY_SIZE`.
- **Perfil ACME**: o perfil pedido ao servidor, verificado com o servidor ao guardar. Vazio usa a predefinição do servidor. Com o Let's Encrypt a predefinição é `shortlived`; clientes que precisam de um Common Name não funcionam com certificados `shortlived` e `tlsserver`. Variável: `ACME_PROFILE` (`none` para vazio).
- **OCSP Must-Staple**: marca os novos certificados como must-staple e mantém o OCSP stapling ativo. Só para CAs que o suportam (ZeroSSL); o Let's Encrypt recusa esses pedidos. Predefinição: ativado para Google Trust Services e ZeroSSL, caso contrário desativado. Variável: `ACME_MUST_STAPLE`.
- **Verificar o certificado do servidor ACME**: predefinição ativado. Desative só para um servidor ACME privado com certificado autoassinado. Variável: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Ambos se aplicam após o reload do nginx que o guardar executa, e ambos desativam a compressão de certificados TLS.

- **OCSP stapling para certificados ACME**: envia a resposta OCSP com os certificados do servidor ACME, quando a CA oferece OCSP. Predefinição: ativado para Google Trust Services e ZeroSSL, caso contrário desativado. Variável: `ACME_OCSP_STAPLING`.
- **OCSP stapling para certificados personalizados**: o mesmo para certificados carregados. Predefinição: desativado. Variável: `CUSTOM_OCSP_STAPLING`.

### Certificado predefinido

- **Certificado para hosts desconhecidos e a interface web**: servido para nomes de host para os quais o NPMpro não tem host e na porta da interface web. Predefinição: integrado, um marcador gerado. Variável: `DEFAULT_CERT_ID` (um ID de certificado; `0` é o integrado). Aplica-se após o reload do nginx que o guardar executa.

### Renovação

- **Intervalo de verificação de renovação**: 1 a 499 horas entre verificações. Um certificado só é renovado quando é devido. Predefinição: 3. Variável: `CERTBOT_RUN_INTERVAL`. Aplica-se logo.

### ECH

- **Intervalo de rotação das chaves ECH**: 1 a 24 horas entre execuções do seu script ECH (`/data/tls/ech/cron.sh`). Usado só quando o script não está vazio. Predefinição: 1. Variável: `ECH_ROTATION_INTERVAL`. Aplica-se logo.

Mais na wiki: Security.
