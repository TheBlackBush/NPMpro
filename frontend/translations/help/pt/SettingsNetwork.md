## Rede

Diga ao NPMpro em que proxies à sua frente se pode confiar quanto ao endereço real do cliente. Sem isto, os registos, as listas de acesso e o CrowdSec veem o endereço do proxy, não o do visitante.

Uma variável definida no contentor tem prioridade sobre a interface e bloqueia o campo (o campo mostra um selo com cadeado, como "Definido por TRUST_IP"). Use a interface para tudo o que não esteja definido no contentor.

- **IPs de proxy de confiança**: um endereço IPv4 ou IPv6 ou intervalo CIDR por linha, por exemplo `10.0.0.0/8`, `192.168.1.5` ou `fd00::/8`. Os pedidos destes endereços podem passar o IP real do cliente em `X-Forwarded-For`. Use para um load balancer ou túnel diretamente à frente do NPMpro. Predefinição: vazio (ninguém é de confiança). Variável: `TRUST_IP` (separada por espaços). Aplica-se após o reload do nginx que o guardar executa.
- **Confiar na Cloudflare**: obtém os intervalos IP da Cloudflare, atualiza-os regularmente e confia neles, para que o nginx veja os IPs reais dos clientes atrás da Cloudflare. Predefinição: desativado. Variável: `TRUST_CLOUDFLARE`. Aplica-se após o reload do nginx que o guardar executa. Leia primeiro as notas sobre a Cloudflare na wiki (Security): pôr a Cloudflare à frente do NPMpro tem custos de privacidade e segurança.

Confie apenas em endereços que controle ou em que confie totalmente. Um endereço de confiança pode afirmar ser qualquer visitante.

Se ao guardar falhar o teste do nginx, nada é guardado e é mostrada a mensagem do nginx.

Mais na wiki: Security.
