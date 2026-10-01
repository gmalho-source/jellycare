/**
 * O que cada problema quer dizer, escrito para o cliente.
 *
 * Um cliente que abre o portal e lê «Falta o header Strict-Transport-Security»
 * fica a saber exatamente o mesmo que sabia antes. Isto é a tradução: o que
 * é, o que muda para o negócio dele, e o que a Jelly faz a respeito.
 *
 * Texto fixo e revisto, e não gerado na hora. São três propriedades que um
 * assistente não dá: a resposta é sempre a mesma, foi lida por uma pessoa
 * antes de chegar a um cliente, e entra no relatório mensal em PDF sem
 * depender de uma chamada a um serviço externo.
 *
 * O tom não é de alarme. A gravidade já vem do crachá ao lado; o texto explica
 * e não assusta — nem por excesso, que faz o cliente ligar em pânico por um
 * cabeçalho em falta, nem por defeito, que é pior no dia em que aquilo é
 * explorado.
 */
export interface ExplicacaoParaCliente {
  /** O título em português de gente, para substituir o técnico. */
  titulo: string
  oQueE: string
  porqueImporta: string
  /** O que a Jelly faz — ou o que vai pedir a quem aloja o site. */
  oQueFazemos: string
}

export const EXPLICACOES: Record<string, ExplicacaoParaCliente> = {
  /* ---------------------------------------------------------------------- */
  /* Disponibilidade e rede                                                 */
  /* ---------------------------------------------------------------------- */

  site_down: {
    titulo: 'O site esteve em baixo',
    oQueE: 'O site não respondeu quando o fomos visitar, a partir de mais do que uma localização.',
    porqueImporta:
      'Enquanto durou, ninguém conseguiu abrir o site — nem clientes, nem quem vinha da pesquisa ou de uma campanha. Paragens repetidas também fazem o Google mostrar o site menos vezes.',
    oQueFazemos:
      'Somos avisados no momento e vamos ver porquê. Se for do alojamento, abrimos o pedido; se for do site, tratamos nós.',
  },
  site_unreachable_from_region: {
    titulo: 'O site esteve inacessível a partir de uma região',
    oQueE:
      'O site respondeu normalmente a partir de umas localizações e não respondeu a partir de outra.',
    porqueImporta:
      'É o tipo de avaria que passa despercebida: continua tudo bem visto daqui e há visitantes de certos países ou operadores que não conseguem entrar.',
    oQueFazemos:
      'Confirmamos se é um problema de rede passageiro ou uma configuração que está a bloquear tráfego legítimo, e corrigimos o que for nosso.',
  },
  connection_refused: {
    titulo: 'O servidor recusou a ligação',
    oQueE: 'O servidor está de pé mas recusou atender o pedido.',
    porqueImporta:
      'Para quem visita é igual a um site em baixo: a página não abre. Costuma ser o serviço do site parado ou uma regra de firewall.',
    oQueFazemos: 'Vemos se o serviço caiu ou se foi bloqueio, e pomos o site a atender outra vez.',
  },
  connection_reset: {
    titulo: 'A ligação foi cortada a meio',
    oQueE: 'O servidor começou a responder e cortou a ligação antes de acabar.',
    porqueImporta:
      'A página abre em branco ou a meio. É frequente em servidores sobrecarregados ou com falta de memória.',
    oQueFazemos:
      'Vemos se o servidor está a ficar sem recursos e tratamos disso com quem aloja o site.',
  },
  dns_failure: {
    titulo: 'O endereço do site não está a ser encontrado',
    oQueE:
      'O DNS é a lista telefónica da internet: é o que traduz o nome do site no endereço do servidor. Essa tradução falhou.',
    porqueImporta:
      'Sem isto o site não abre para ninguém, e o email do domínio também pode deixar de funcionar.',
    oQueFazemos: 'Vamos ao registo do domínio ver o que mudou ou expirou, e repomos.',
  },
  network_error: {
    titulo: 'Houve um erro de rede a chegar ao site',
    oQueE: 'A ligação ao servidor falhou por uma razão de rede.',
    porqueImporta:
      'Uma vez é ruído da internet. Repetido, é sinal de um problema no alojamento ou no caminho até ele.',
    oQueFazemos: 'Se voltar a acontecer, levamos o padrão a quem aloja o site com as datas e horas.',
  },
  timeout: {
    titulo: 'O site demorou demasiado a responder',
    oQueE: 'O servidor não respondeu dentro do tempo que damos antes de desistir.',
    porqueImporta:
      'Um visitante desiste muito antes disso. Na prática, para quem chega naquele momento, o site está em baixo.',
    oQueFazemos:
      'Vemos o que está a prender o servidor — base de dados, plugins, falta de recursos — e atacamos a causa.',
  },
  slow_response: {
    titulo: 'O site está a responder devagar',
    oQueE: 'O servidor responde, mas demora mais do que devia a começar a entregar a página.',
    porqueImporta:
      'Lentidão faz perder visitantes antes de a página abrir, e conta para a posição do site na pesquisa da Google.',
    oQueFazemos:
      'Procuramos a origem — consultas à base de dados, plugins pesados, falta de cache — e propomos o que fazer.',
  },
  content_missing: {
    titulo: 'A página abriu mas sem o conteúdo esperado',
    oQueE:
      'O servidor respondeu «está tudo bem», mas o texto que combinámos que tem de aparecer na página inicial não estava lá.',
    porqueImporta:
      'É o caso mais traiçoeiro: as ferramentas normais de monitorização dizem que o site está no ar, e o que o visitante vê é uma página em branco ou uma mensagem de erro.',
    oQueFazemos:
      'Vamos ver o que a página está mesmo a devolver e repomos o conteúdo ou corrigimos o erro por baixo.',
  },
  redirect_chain_long: {
    titulo: 'O endereço passa por demasiados reencaminhamentos',
    oQueE:
      'Antes de chegar à página final, o browser é mandado de endereço em endereço mais vezes do que devia.',
    porqueImporta:
      'Cada salto acrescenta espera, e a Google penaliza cadeias longas. Às vezes também é sinal de configuração antiga esquecida.',
    oQueFazemos: 'Simplificamos os reencaminhamentos para o caminho mais curto.',
  },
  http_not_redirected: {
    titulo: 'O site continua a abrir sem ligação segura',
    oQueE:
      'Quem escrever o endereço sem «https» fica em ligação não encriptada, em vez de ser reencaminhado para a versão segura.',
    porqueImporta:
      'Nessa ligação, o que o visitante escreve pode ser lido ou alterado por quem esteja na mesma rede — um wi-fi público, por exemplo. Os browsers também marcam a página como «não segura».',
    oQueFazemos:
      'Configuramos o reencaminhamento automático para a versão segura, e só depois reforçamos o resto.',
  },

  /* ---------------------------------------------------------------------- */
  /* Certificado e ligação segura                                           */
  /* ---------------------------------------------------------------------- */

  cert_expired: {
    titulo: 'O certificado de segurança expirou',
    oQueE:
      'O certificado é o que prova que o site é mesmo o site e encripta a ligação. O do seu site já passou da validade.',
    porqueImporta:
      'Os browsers mostram um ecrã vermelho de aviso antes de deixar entrar. A esmagadora maioria dos visitantes vira costas ali.',
    oQueFazemos: 'Renovamos com urgência e deixamos a renovação automática a funcionar.',
  },
  cert_expiring: {
    titulo: 'O certificado de segurança está a expirar',
    oQueE: 'O certificado ainda é válido, mas está perto do fim.',
    porqueImporta:
      'Se expirar, os browsers passam a avisar os visitantes de que o site não é seguro. É um problema que se evita por completo se for tratado a tempo.',
    oQueFazemos: 'Renovamos antes da data e confirmamos que a renovação automática ficou de pé.',
  },
  cert_hostname_mismatch: {
    titulo: 'O certificado não cobre o endereço do site',
    oQueE: 'O certificado instalado foi emitido para outro endereço e não para este.',
    porqueImporta:
      'Os browsers tratam isto como um certificado inválido e avisam o visitante antes de o deixar entrar.',
    oQueFazemos: 'Emitimos um certificado que cubra todos os endereços por onde o site é servido.',
  },
  cert_untrusted: {
    titulo: 'O certificado não é reconhecido pelos browsers',
    oQueE:
      'O certificado existe, mas não foi emitido por uma entidade que os browsers reconheçam, ou falta-lhe uma peça da cadeia.',
    porqueImporta: 'O visitante vê o mesmo aviso de perigo que veria num certificado expirado.',
    oQueFazemos: 'Substituímos ou completamos a instalação para a cadeia ficar válida.',
  },
  cert_weak_key: {
    titulo: 'O certificado usa uma chave fraca',
    oQueE: 'A chave criptográfica do certificado é mais curta do que hoje se considera seguro.',
    porqueImporta:
      'Não é um perigo imediato, mas os browsers vão deixando de aceitar chaves antigas — e quando deixam, o site fica inacessível de um dia para o outro.',
    oQueFazemos: 'Reemitimos o certificado com uma chave atual.',
  },
  tls_failure: {
    titulo: 'A ligação segura não se estabeleceu',
    oQueE: 'Não foi possível abrir uma ligação encriptada com o servidor.',
    porqueImporta:
      'Enquanto durar, o site não abre em condições nos browsers modernos.',
    oQueFazemos:
      'Vemos a configuração de segurança do servidor — protocolos e cifras — e repomos uma combinação que funcione.',
  },

  /* ---------------------------------------------------------------------- */
  /* Cabeçalhos e configuração de segurança                                 */
  /* ---------------------------------------------------------------------- */

  missing_hsts: {
    titulo: 'O site não obriga os browsers a usar sempre ligação segura',
    oQueE:
      'Falta a instrução que diz ao browser «a partir de agora, nunca fales com este site sem encriptação».',
    porqueImporta:
      'Sem ela, o primeiro acesso de cada visitante pode ser intercetado antes de o site o mandar para a versão segura. É uma janela pequena, mas é a janela que se usa em redes públicas.',
    oQueFazemos:
      'Ativamos a instrução por etapas. Fazemo-lo com cuidado porque, mal configurada, é difícil de reverter durante meses.',
  },
  missing_csp: {
    titulo: 'Falta uma política de conteúdo permitido',
    oQueE:
      'É uma lista que diz ao browser de que sítios é que ele pode carregar scripts e conteúdos neste site.',
    porqueImporta:
      'Sem ela, se alguém conseguir injetar código malicioso numa página, o browser executa-o sem hesitar. Com ela, o estrago fica contido.',
    oQueFazemos:
      'Preparamos a política a partir do que o site usa de verdade e ativamo-la primeiro em modo de observação, para não partir funcionalidades.',
  },
  missing_content_type_options: {
    titulo: 'Falta uma proteção contra ficheiros disfarçados',
    oQueE:
      'Falta a instrução que impede o browser de adivinhar o tipo de um ficheiro em vez de acreditar no que o servidor diz.',
    porqueImporta:
      'Sem ela, um ficheiro carregado por um visitante pode ser interpretado como programa e executado.',
    oQueFazemos: 'Acrescentamos a instrução. É uma alteração pequena e sem risco.',
  },
  missing_frame_protection: {
    titulo: 'O site pode ser embebido dentro de outro',
    oQueE: 'Nada impede que outra pessoa mostre o seu site dentro de uma página dela.',
    porqueImporta:
      'É a técnica usada para enganar visitantes: mostram o seu site por baixo de uma página falsa e o clique acaba noutro sítio. Também facilita cópias do site para fraude.',
    oQueFazemos: 'Acrescentamos a instrução que só permite embeber a partir dos seus domínios.',
  },
  missing_referrer_policy: {
    titulo: 'O site partilha demasiada informação ao sair para outro',
    oQueE:
      'Quando um visitante clica num link para fora, o browser conta ao outro site a página exata de onde veio.',
    porqueImporta:
      'Se o endereço tiver informação interna — um identificador, um termo de pesquisa, uma página privada — ela sai com o clique.',
    oQueFazemos: 'Configuramos o site para partilhar apenas o domínio e não a página completa.',
  },
  insecure_cookie: {
    titulo: 'Há cookies a viajar sem proteção',
    oQueE:
      'Alguns cookies do site não estão marcados para só viajarem em ligação encriptada, ou ficam ao alcance de scripts.',
    porqueImporta:
      'Se um desses cookies for o que mantém uma sessão iniciada, quem o apanhe entra na conta sem precisar da palavra-passe.',
    oQueFazemos:
      'Marcamos os cookies corretamente. Nos que vêm de plugins, tratamos com quem os mantém.',
  },
  mixed_content: {
    titulo: 'A página segura carrega conteúdo inseguro',
    oQueE:
      'A página abre em ligação encriptada mas vai buscar imagens, scripts ou folhas de estilo por ligação não encriptada.',
    porqueImporta:
      'O cadeado deixa de valer: a parte não encriptada pode ser alterada por quem esteja na mesma rede. Os browsers bloqueiam parte desse conteúdo, e isso parte a apresentação da página.',
    oQueFazemos: 'Corrigimos os endereços para a versão segura.',
  },
  server_version_disclosed: {
    titulo: 'O servidor anuncia que versão está a correr',
    oQueE: 'Em cada resposta, o servidor diz publicamente que programa e que versão está a usar.',
    porqueImporta:
      'Não é uma falha por si. Mas poupa trabalho a quem procura sites com versões antigas para atacar em massa — que é como a maior parte dos ataques acontece.',
    oQueFazemos: 'Desligamos essa informação na configuração do servidor.',
  },

  /* ---------------------------------------------------------------------- */
  /* Ficheiros que não deviam estar acessíveis                              */
  /* ---------------------------------------------------------------------- */

  exposed_env: {
    titulo: 'Ficheiro de configuração acessível publicamente',
    oQueE:
      'Um ficheiro de configuração do site está a ser servido a quem o peça. Estes ficheiros costumam ter palavras-passe da base de dados e chaves de serviços.',
    porqueImporta:
      'É dos achados mais graves que fazemos. Com aquilo, quem o encontrar pode entrar na base de dados e usar os serviços pagos em nome do site.',
    oQueFazemos:
      'Bloqueamos o acesso imediatamente e mudamos as palavras-passe e chaves que lá estavam — porque temos de assumir que já foram vistas.',
  },
  exposed_git: {
    titulo: 'O histórico de código do site está acessível',
    oQueE:
      'A pasta com o histórico de alterações ao código ficou publicada junto com o site.',
    porqueImporta:
      'Com ela, qualquer pessoa descarrega o código-fonte inteiro, incluindo palavras-passe que alguma vez lá tenham estado, mesmo que já tenham sido removidas.',
    oQueFazemos:
      'Bloqueamos o acesso e verificamos o que estava lá dentro para saber o que é preciso mudar.',
  },
  exposed_git_config: {
    titulo: 'Configuração do repositório de código acessível',
    oQueE: 'Um ficheiro do sistema de controlo de versões está a ser servido publicamente.',
    porqueImporta:
      'Revela onde vive o código do site e, por vezes, credenciais de acesso a ele. É também o sinal que leva um atacante a procurar o resto.',
    oQueFazemos: 'Bloqueamos o acesso e confirmamos que mais nada dessa pasta está visível.',
  },
  exposed_wp_config_backup: {
    titulo: 'Cópia do ficheiro de configuração do WordPress acessível',
    oQueE:
      'Existe uma cópia de segurança do ficheiro principal de configuração acessível a quem a peça.',
    porqueImporta:
      'Ao contrário do original, a cópia é servida como texto: abre-se no browser e mostra a palavra-passe da base de dados.',
    oQueFazemos:
      'Apagamos a cópia e mudamos as credenciais que lá estavam.',
  },
  exposed_debug_log: {
    titulo: 'Registo de erros acessível publicamente',
    oQueE: 'O ficheiro onde o site escreve os erros está a ser servido a quem o peça.',
    porqueImporta:
      'Estes registos costumam trazer caminhos internos, consultas à base de dados e, por vezes, dados de visitantes. É um mapa do que está a correr mal.',
    oQueFazemos: 'Bloqueamos o acesso e desligamos a escrita do registo em produção.',
  },
  exposed_phpinfo: {
    titulo: 'Página de diagnóstico do servidor acessível',
    oQueE:
      'Há uma página de diagnóstico publicada que descreve a configuração completa do servidor.',
    porqueImporta:
      'Entrega numa página todas as versões instaladas e caminhos internos. Costuma ser esquecida depois de uma instalação.',
    oQueFazemos:
      'Removemos a página e procuramos outras do género esquecidas no servidor.',
  },
  exposed_server_status: {
    titulo: 'Painel de estado do servidor acessível',
    oQueE: 'O painel interno de estado do servidor está aberto ao público.',
    porqueImporta:
      'Mostra em tempo real que endereços estão a ser visitados e a partir de onde — incluindo zonas privadas do site.',
    oQueFazemos: 'Restringimos o acesso ao painel.',
  },
  exposed_ds_store: {
    titulo: 'Ficheiro do macOS acessível no servidor',
    oQueE:
      'Um ficheiro que o macOS cria automaticamente foi enviado para o servidor com o resto do site.',
    porqueImporta:
      'Não é perigoso em si, mas revela a lista de ficheiros e pastas daquela diretoria, incluindo os que não estão ligados a partir de lado nenhum.',
    oQueFazemos: 'Removemos o ficheiro e ajustamos o processo de publicação para não voltar a subir.',
  },

  /* ---------------------------------------------------------------------- */
  /* Email do domínio                                                       */
  /* ---------------------------------------------------------------------- */

  spf_missing: {
    titulo: 'Falta a autorização de quem pode enviar email pelo domínio',
    oQueE:
      'O SPF é o registo que diz quais os servidores autorizados a enviar email em nome do seu domínio. Não existe.',
    porqueImporta:
      'Sem ele, qualquer pessoa pode enviar email que aparenta vir do seu domínio. E os seus emails legítimos têm mais probabilidade de cair no spam.',
    oQueFazemos: 'Publicamos o registo com os serviços que envia mesmo em seu nome.',
  },
  spf_duplicated: {
    titulo: 'Há mais do que uma autorização de envio de email',
    oQueE: 'Existem dois ou mais registos SPF publicados no domínio.',
    porqueImporta:
      'A norma diz que mais do que um invalida todos. Na prática é o mesmo que não ter nenhum, e o efeito aparece como emails a cair no spam sem razão aparente.',
    oQueFazemos: 'Juntamos tudo num registo só.',
  },
  spf_permissive: {
    titulo: 'A autorização de envio de email é demasiado aberta',
    oQueE: 'O registo SPF existe mas aceita praticamente qualquer servidor.',
    porqueImporta:
      'Dá a aparência de estar protegido sem estar: continua a ser possível enviar email a fingir que é do seu domínio.',
    oQueFazemos: 'Apertamos o registo para os serviços que usa de verdade.',
  },
  dkim_not_found: {
    titulo: 'Os emails do domínio não vão assinados',
    oQueE:
      'O DKIM é a assinatura digital que prova que um email saiu mesmo de si e não foi alterado pelo caminho. Não a encontrámos.',
    porqueImporta:
      'Sem assinatura, os servidores de destino confiam menos e mandam mais emails seus para o spam.',
    oQueFazemos: 'Ativamos a assinatura junto do serviço de email e publicamos a chave no domínio.',
  },
  dmarc_missing: {
    titulo: 'Falta a regra que protege o domínio contra falsificação',
    oQueE:
      'O DMARC diz aos servidores de destino o que fazer com um email que diz ser seu mas não passa nas verificações. Não existe.',
    porqueImporta:
      'É o que impede alguém de se fazer passar por si para enganar os seus clientes ou fornecedores. Sem ele, cada servidor decide como quer.',
    oQueFazemos:
      'Publicamos a regra, começando em modo de observação para não travar email legítimo, e apertamos depois.',
  },
  dmarc_partial: {
    titulo: 'A regra de proteção do domínio está incompleta',
    oQueE: 'O registo DMARC existe mas está mal formado ou falta-lhe informação.',
    porqueImporta: 'Incompleto, pode ser ignorado — e a proteção que parece estar lá não está.',
    oQueFazemos: 'Corrigimos o registo.',
  },
  dmarc_policy_none: {
    titulo: 'A proteção do domínio está só a observar',
    oQueE:
      'A regra DMARC existe mas está configurada para não fazer nada quando apanha um email falsificado.',
    porqueImporta:
      'É o primeiro passo certo, mas ficar aqui não protege ninguém. Um email a fingir ser seu continua a ser entregue.',
    oQueFazemos:
      'Analisamos os relatórios para confirmar que o seu email legítimo está todo a passar, e depois passamos a regra para rejeitar.',
  },
  mx_missing: {
    titulo: 'O domínio não tem servidor de email configurado',
    oQueE: 'Não há registo que diga para onde encaminhar o email dirigido ao seu domínio.',
    porqueImporta:
      'Emails enviados para endereços do seu domínio não chegam a lado nenhum — incluindo os que vêm dos formulários do site.',
    oQueFazemos: 'Publicamos os registos do seu serviço de email.',
  },
  mx_unresolvable: {
    titulo: 'O servidor de email do domínio não é encontrado',
    oQueE: 'O registo existe mas aponta para um servidor que não responde.',
    porqueImporta:
      'Na prática é igual a não ter: o email dirigido ao domínio não é entregue.',
    oQueFazemos: 'Corrigimos o destino junto de quem gere o domínio.',
  },

  /* ---------------------------------------------------------------------- */
  /* Formulários                                                            */
  /* ---------------------------------------------------------------------- */

  form_submission_failed: {
    titulo: 'Um formulário do site não está a aceitar submissões',
    oQueE:
      'Preenchemos o formulário como um visitante faria e ele não chegou a submeter.',
    porqueImporta:
      'Um formulário de contacto partido é um funil de vendas fechado sem ninguém dar por isso. É a falha mais cara que encontramos, e a mais silenciosa.',
    oQueFazemos: 'Vamos ver o que está a falhar na submissão e repomos o formulário a funcionar.',
  },
  form_email_not_delivered: {
    titulo: 'Um formulário submete mas o email não chega',
    oQueE:
      'O formulário aceitou a submissão e mostrou a mensagem de sucesso, mas o email de aviso não chegou ao destino.',
    porqueImporta:
      'É pior do que um formulário partido: o visitante fica convencido de que o contacto foi feito e do seu lado não aparece nada.',
    oQueFazemos: 'Seguimos o caminho do email desde o site até à caixa de destino e corrigimos o troço que falha.',
  },
  form_email_in_spam: {
    titulo: 'Os avisos de um formulário estão a cair no spam',
    oQueE: 'O email do formulário é entregue, mas vai para a pasta de spam em vez da caixa de entrada.',
    porqueImporta:
      'Os contactos existem e não são vistos — ou só são vistos dias depois, quando já não valem nada.',
    oQueFazemos:
      'Corrigimos a autenticação do email do domínio, que é quase sempre a causa.',
  },
  form_email_slow: {
    titulo: 'Os avisos de um formulário demoram a chegar',
    oQueE: 'O email chega, mas com um atraso acima do normal.',
    porqueImporta:
      'Num pedido de orçamento ou marcação, responder horas depois é muitas vezes responder tarde de mais.',
    oQueFazemos: 'Vemos onde está a fila que atrasa o envio e propomos como encurtá-la.',
  },
  form_email_auth_risk: {
    titulo: 'Os avisos de um formulário correm risco de ser bloqueados',
    oQueE:
      'O email do formulário está a chegar, mas sem passar nas verificações de autenticidade do domínio.',
    porqueImporta:
      'Hoje ainda entra. À medida que os fornecedores de email apertam as regras, um dia deixa de entrar — e o primeiro sinal é deixarem de aparecer contactos.',
    oQueFazemos: 'Pomos a autenticação do domínio em ordem antes de isso acontecer.',
  },
  form_page_unreachable: {
    titulo: 'A página de um formulário não abre',
    oQueE: 'A página onde vive o formulário não respondeu.',
    porqueImporta: 'Sem a página não há formulário, e o contacto por essa via está fechado.',
    oQueFazemos: 'Tratamos a falha da página, que costuma ser a mesma coisa que afeta o resto do site.',
  },
  form_fields_unconfigured: {
    titulo: 'Um formulário ainda não está preparado para ser testado',
    oQueE:
      'Encontrámos o formulário mas ainda não sabemos que campos preencher para o testar com segurança.',
    porqueImporta:
      'Enquanto assim estiver, esse formulário não está a ser verificado — e um formulário não verificado pode estar partido sem se saber.',
    oQueFazemos: 'É trabalho nosso de configuração. Tratamos disso e o teste passa a correr.',
  },
  form_delivery_unverified: {
    titulo: 'Não conseguimos confirmar a entrega de um formulário',
    oQueE:
      'O formulário submeteu, mas não temos forma de confirmar se o aviso chegou ao destino.',
    porqueImporta:
      'É um ponto cego: pode estar tudo bem, mas não podemos prometer que está.',
    oQueFazemos:
      'Configuramos o destino de teste para passarmos a confirmar a entrega de ponta a ponta.',
  },
  contact_form_disappeared: {
    titulo: 'Um formulário desapareceu da página',
    oQueE: 'Um formulário que existia e estava a ser verificado deixou de estar na página.',
    porqueImporta:
      'Pode ter sido intencional — uma alteração ao site — ou pode ter partido numa atualização e ninguém ter reparado.',
    oQueFazemos: 'Confirmamos consigo se foi de propósito. Se não foi, repomos.',
  },
  declared_form_page_empty: {
    titulo: 'Uma página indicada não tem formulário nenhum',
    oQueE:
      'Fomos verificar uma página que nos foi indicada como tendo formulário e não encontrámos lá nenhum.',
    porqueImporta:
      'Ou o formulário foi removido, ou o endereço mudou. Em qualquer dos casos há uma via de contacto que julgávamos estar a vigiar e não estava.',
    oQueFazemos: 'Confirmamos o endereço certo e voltamos a pôr a verificação a correr.',
  },
  declared_form_page_unreachable: {
    titulo: 'Uma página indicada não abre',
    oQueE: 'A página que nos foi indicada como tendo formulário não respondeu.',
    porqueImporta:
      'Enquanto não abrir, esse formulário não é verificado — e se o endereço mudou, há visitantes a bater numa página que já não existe.',
    oQueFazemos: 'Vemos se a página mudou de endereço ou se está mesmo em baixo.',
  },

  /* ---------------------------------------------------------------------- */
  /* WordPress                                                              */
  /* ---------------------------------------------------------------------- */

  wp_core_outdated: {
    titulo: 'O WordPress está desatualizado',
    oQueE: 'A versão do WordPress instalada não é a mais recente.',
    porqueImporta:
      'As atualizações do WordPress corrigem falhas conhecidas e publicadas. A partir do momento em que saem, as versões antigas passam a ser alvo de procura automática.',
    oQueFazemos:
      'Atualizamos dentro da janela de manutenção combinada, com cópia de segurança feita antes.',
  },
  wp_updates_pending: {
    titulo: 'Há plugins ou temas por atualizar',
    oQueE: 'Alguns componentes instalados têm versão nova disponível.',
    porqueImporta:
      'É por aqui que entra a maior parte dos sites WordPress comprometidos: não pelo WordPress em si, mas por um plugin desatualizado.',
    oQueFazemos:
      'Atualizamos na janela de manutenção, com cópia feita antes e verificação do site depois.',
  },
  wp_known_vulnerability: {
    titulo: 'Há um componente com falha de segurança conhecida',
    oQueE:
      'Um plugin ou tema instalado tem uma vulnerabilidade publicada, com a correção já disponível.',
    porqueImporta:
      'É diferente de estar só desatualizado: aqui a falha é pública, está descrita, e existem ferramentas automáticas a procurar sites nestas condições.',
    oQueFazemos:
      'Tratamos com prioridade sobre o resto das atualizações. Se não houver correção, avaliamos substituir ou desativar o componente.',
  },
  wp_php_fatal: {
    titulo: 'O site registou um erro grave',
    oQueE: 'Houve um erro que interrompeu a execução de uma página.',
    porqueImporta:
      'Uma página que rebenta assim fica em branco para quem a visita. Costuma vir de um conflito entre componentes ou de uma versão de PHP diferente da esperada.',
    oQueFazemos: 'Encontramos o componente responsável e corrigimos ou substituímos.',
  },
  wp_user_enumeration: {
    titulo: 'É possível descobrir os nomes de utilizador do site',
    oQueE:
      'O site revela quais são as contas de administração quando lhe perguntam da forma certa.',
    porqueImporta:
      'Adivinhar uma palavra-passe é muito mais fácil quando já se sabe o nome de utilizador. É o primeiro passo de um ataque por tentativa e erro.',
    oQueFazemos: 'Bloqueamos essa forma de consulta e reforçamos a proteção da página de entrada.',
  },
  wp_xmlrpc_enabled: {
    titulo: 'Há uma porta antiga de acesso remoto aberta',
    oQueE:
      'O XML-RPC é uma interface antiga do WordPress que permite comandar o site à distância. Está ativa.',
    porqueImporta:
      'É muito usada para tentar milhares de palavras-passe de uma vez e para amplificar ataques. A maioria dos sites já não precisa dela.',
    oQueFazemos: 'Confirmamos se alguma coisa sua ainda depende dela e, se não, desligamos.',
  },
  wp_backup_missing: {
    titulo: 'Não há cópias de segurança do site',
    oQueE: 'Não encontrámos nenhuma cópia de segurança recente.',
    porqueImporta:
      'É o problema que só se sente uma vez, e nessa vez é total: sem cópia, um site perdido é um site refeito de raiz.',
    oQueFazemos: 'Pomos as cópias automáticas a correr e confirmamos que dá mesmo para repor.',
  },
  wp_backup_stale: {
    titulo: 'A última cópia de segurança é antiga',
    oQueE: 'Existem cópias, mas a mais recente já tem mais tempo do que devia.',
    porqueImporta:
      'Repor uma cópia antiga significa perder tudo o que aconteceu desde então — encomendas, contactos, conteúdo novo.',
    oQueFazemos: 'Vemos porque é que as cópias pararam e retomamos a periodicidade.',
  },
  wp_auto_update_blocked: {
    titulo: 'As atualizações automáticas não conseguiram correr',
    oQueE: 'Tentámos aplicar atualizações automaticamente e não foi possível.',
    porqueImporta:
      'As atualizações ficam por fazer, e um site que ninguém atualiza acumula falhas conhecidas.',
    oQueFazemos: 'Vemos o que está a bloquear — permissões, espaço em disco, conflito — e aplicamos à mão.',
  },
  wp_auto_update_no_window: {
    titulo: 'Faltam janelas de manutenção para atualizar',
    oQueE:
      'As atualizações automáticas só correm dentro de janelas combinadas consigo, e não há nenhuma definida.',
    porqueImporta:
      'É uma salvaguarda e não uma falha: não mexemos no site sem hora combinada. Mas enquanto não houver janela, as atualizações esperam.',
    oQueFazemos: 'Combinamos consigo um horário e configuramos a janela.',
  },

  /* ---------------------------------------------------------------------- */
  /* Conteúdo, desempenho e reputação                                       */
  /* ---------------------------------------------------------------------- */

  link_broken: {
    titulo: 'Há links partidos no site',
    oQueE: 'Encontrámos links que levam a páginas que já não existem ou não respondem.',
    porqueImporta:
      'Quem clica bate numa página de erro e muitas vezes sai. A Google também usa isto como sinal de site mal mantido.',
    oQueFazemos: 'Corrigimos os endereços ou reencaminhamos para o destino certo.',
  },
  asset_missing: {
    titulo: 'Há imagens ou ficheiros em falta',
    oQueE: 'Algumas páginas pedem imagens, folhas de estilo ou scripts que já não estão no servidor.',
    porqueImporta:
      'Ao contrário de um link partido, isto vê-se logo: a página aparece desalinhada ou com espaços em branco onde devia haver imagens.',
    oQueFazemos: 'Repomos os ficheiros em falta ou corrigimos os endereços.',
  },
  page_speed_poor: {
    titulo: 'O site está lento a abrir',
    oQueE:
      'Medimos a velocidade com que a página abre, como a Google mede, e a pontuação ficou abaixo do aceitável.',
    porqueImporta:
      'A velocidade conta diretamente para a posição do site na pesquisa da Google, e é o que faz quem chega pelo telemóvel desistir antes de a página abrir.',
    oQueFazemos:
      'Identificamos o que está a pesar — imagens grandes, scripts a bloquear, falta de cache — e apresentamos um plano por ordem de impacto.',
  },
  blacklisted_web_risk: {
    titulo: 'A Google marca uma página do site como perigosa',
    oQueE:
      'Uma página do site está nas listas da Google de sites com malware, phishing ou software indesejado. O Chrome mostra um ecrã vermelho de aviso antes de a abrir.',
    porqueImporta:
      'Quase ninguém passa o aviso: as visitas caem de um dia para o outro, o site perde posição na pesquisa e os anúncios podem ser suspensos. Normalmente significa que o site foi comprometido.',
    oQueFazemos:
      'Tratamos como incidente: confirmamos e limpamos a infeção, fechamos a porta por onde entrou e pedimos à Google a revisão do site.',
  },
  blacklisted_urlhaus: {
    titulo: 'O site aparece numa lista pública de sites maliciosos',
    oQueE:
      'O endereço do site foi assinalado numa base de dados pública usada por browsers e filtros de email.',
    porqueImporta:
      'É dos problemas mais graves para o negócio: os browsers passam a avisar antes de entrar, e os emails do domínio começam a ser bloqueados. A recuperação da reputação demora mais do que a correção técnica.',
    oQueFazemos:
      'Investigamos com urgência se o site está mesmo comprometido, limpamos o que houver a limpar, e submetemos o pedido de remoção da lista.',
  },
}

/** A explicação de um código, ou `null` se ainda não houver uma escrita. */
export function explicacaoDe(code: string): ExplicacaoParaCliente | null {
  return EXPLICACOES[code] ?? null
}
