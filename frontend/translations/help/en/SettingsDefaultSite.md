## Default Site

The default site is what nginx answers when a visitor reaches NPMpro with a host name that no host uses, or with the server's IP address. Pick the answer here. It applies to all unknown names.

Saving tests the new choice with nginx first. If the test fails, nothing is saved, the previous default site stays and the nginx error is in the container log.

- **Congratulations Page** (default): shows the NPMpro welcome page.
- **404 Page**: answers with a 404 Not Found page.
- **No Response (444)**: closes the connection without any answer. Use it to give scanners nothing to see. HTTPS requests for unknown names are refused during the TLS handshake.
- **Redirect**: sends visitors to another address with a temporary redirect (302). Enter a full `http://` or `https://` URL without spaces, quotes or `; { } #`, up to 255 characters.
- **Custom HTML**: shows your own HTML page. The **HTTP Status Code** below it is optional, from 400 to 599. Leave it empty for 200 (OK).

For every choice except No Response, requests to unknown names over plain HTTP are first redirected to HTTPS, and HTTPS requests use the certificate chosen as **Default certificate** in Settings, Certificates & TLS.

This section has no environment variables, so the change applies when you save.
