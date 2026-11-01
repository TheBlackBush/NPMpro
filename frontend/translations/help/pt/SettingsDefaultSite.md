## Site Predefinido

O site predefinido é o que o nginx responde quando um visitante chega ao NPMpro com um nome de host que nenhum host usa, ou com o endereço IP do servidor. Escolha aqui a resposta. Aplica-se a todos os nomes desconhecidos.

Ao guardar, a nova escolha é primeiro testada com o nginx. Se o teste falhar, nada é guardado, o site predefinido anterior mantém-se e o erro do nginx fica no registo do contentor.

- **Página de Parabéns** (predefinição): mostra a página de boas-vindas do NPMpro.
- **Página 404**: responde com uma página 404 Not Found.
- **Sem Resposta (444)**: fecha a ligação sem qualquer resposta. Use para não dar nada a ver aos scanners. Os pedidos HTTPS para nomes desconhecidos são recusados durante o handshake TLS.
- **Redirecionamento**: envia os visitantes para outro endereço com um redirecionamento temporário (302). Introduza um URL completo `http://` ou `https://` sem espaços, aspas ou `; { } #`, até 255 carateres.
- **HTML Personalizado**: mostra uma página HTML sua. O **Código de Estado HTTP** abaixo é opcional, de 400 a 599. Deixe vazio para 200 (OK).

Para todas as escolhas exceto Sem Resposta, os pedidos para nomes desconhecidos em HTTP simples são primeiro redirecionados para HTTPS, e os pedidos HTTPS usam o certificado escolhido como **Certificado predefinido** em Definições, Certificados e TLS.

Esta secção não tem variáveis de ambiente, por isso a alteração aplica-se ao guardar.
