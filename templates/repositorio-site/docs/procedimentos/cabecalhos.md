# Cabeçalhos de segurança

Problemas: `missing_hsts`, `missing_csp`, `missing_frame_protection`,
`missing_content_type_options`, `missing_referrer_policy`,
`http_not_redirected`, `server_version_disclosed`.

## Onde se põem

Decide pelo `site.yml`, por esta ordem:

1. **Cloudflare à frente** (`alojamento.cloudflare: true`): uma *Transform
   Rule* de cabeçalhos de resposta cobre o site inteiro, sem tocar no
   alojamento. Prepara a regra em `config/cloudflare/cabecalhos.md`.
2. **Apache ou LiteSpeed** (cPanel, Plesk, a maioria dos WordPress): bloco no
   `.htaccess` da raiz, em `config/apache/cabecalhos.htaccess`. Vai **antes**
   do bloco `# BEGIN WordPress`, que o WordPress reescreve.
3. **Nginx:** `add_header ... always;` no bloco `server`, em
   `config/nginx/cabecalhos.conf`. Normalmente só o alojamento o aplica: escreve
   o pedido ao suporte.
4. **Vercel / Next.js:** `headers()` no `next.config` ou `vercel.json`, no
   código do site.
5. **Alojamento gerido sem acesso** (Kinsta, WP Engine, Wix, Shopify): um
   plugin (WordPress) ou o pedido ao suporte. Diz qual e porquê.

## Valores

Começa sempre pelo que não parte nada:

| Cabeçalho | Valor | Notas |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Seguro sempre. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Seguro sempre. |
| `X-Frame-Options` | `SAMEORIGIN` | Parte embeds do site noutros domínios, se existirem. Diz isso no risco. |
| `Strict-Transport-Security` | `max-age=31536000` | **Sem `preload`** e sem `includeSubDomains`, a não ser que todos os subdomínios tenham HTTPS: confirma-o com `dig` e `curl` antes. Começa em `max-age=86400` se houver dúvidas. |
| `Content-Security-Policy` | primeiro **`Content-Security-Policy-Report-Only`** | Uma CSP aplicada às cegas parte o site (Analytics, Pixel, fontes, chat). Prepara a versão *Report-Only*, com as origens que vês no HTML, e deixa a passagem a obrigatória para depois de uma semana sem queixas. |

- `http_not_redirected`: redireção 301 de `http://` para `https://`, no mesmo
  sítio dos cabeçalhos (ou a opção «Always Use HTTPS» do Cloudflare).
- `server_version_disclosed`: `ServerTokens Prod` / `server_tokens off;`, que
  quase sempre só o alojamento muda. Em `.htaccess` dá para tirar
  `X-Powered-By` com `Header unset X-Powered-By`.

## Confirmar

`curl -sSI https://dominio/ | grep -iE 'strict-transport|content-security|x-frame|x-content-type|referrer-policy'`
