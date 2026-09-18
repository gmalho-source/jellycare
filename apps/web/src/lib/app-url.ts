/**
 * Origem pública da aplicação.
 *
 * Não se deriva do `request.url`. Na saída standalone do Next, atrás do proxy
 * do Fly, esse URL traz o endereço em que o servidor escuta — `0.0.0.0:3000` —
 * e não o domínio por onde a pessoa entrou. Um redirecionamento construído a
 * partir dele manda o browser para lado nenhum, e é particularmente cruel na
 * entrada: a sessão fica criada e o token gasto, mas a pessoa aterra num erro
 * e, ao voltar a clicar na ligação, recebe a mensagem de ligação inválida.
 */
export function appOrigin(requestHeaders?: Headers): string {
  const configured = process.env.JELLYCARE_APP_URL
  if (configured) return configured.replace(/\/+$/, '')

  // Sem configuração, resta o cabeçalho `host`. Serve em desenvolvimento e é
  // o suficiente; em produção o `JELLYCARE_APP_URL` deve estar sempre
  // definido, porque um `host` forjado num pedido faria a ligação de entrada
  // apontar para o domínio de quem o forjou.
  const host = requestHeaders?.get('host')
  if (host) {
    const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https'
    return `${protocol}://${host}`
  }

  return 'http://localhost:3000'
}

/** Um URL absoluto na origem pública, a partir de um caminho. */
export function appUrl(path: string, requestHeaders?: Headers): URL {
  return new URL(path, `${appOrigin(requestHeaders)}/`)
}
