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
  const configured = process.env.JELLYCARE_APP_URL?.trim().replace(/\/+$/, '')
  if (configured) {
    // Só a origem. Um caminho ou credenciais no valor configurado não podem
    // entrar na ligação de entrada.
    let url: URL
    try {
      url = new URL(configured)
    } catch {
      throw new Error('JELLYCARE_APP_URL não é um endereço válido.')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('JELLYCARE_APP_URL tem de ser http ou https.')
    }
    return url.origin
  }

  // Sem configuração, em produção não há fallback. O cabeçalho `host` é
  // controlado por quem faz o pedido: usá-lo na ligação de entrada mandava o
  // link para o domínio de quem o forjou. Em desenvolvimento o fallback
  // mantém-se, senão a entrada local deixava de funcionar.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JELLYCARE_APP_URL não está definido.')
  }

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
