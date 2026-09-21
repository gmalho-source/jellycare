# Riscos legais, éticos e operacionais

Estes pontos não são burocracia — são o que distingue uma plataforma de
manutenção de uma ferramenta que nos mete em problemas.

## Autorização para scanning

Verificar vulnerabilidades num site sem autorização do proprietário é, na
melhor das hipóteses, uma zona cinzenta legal e, em Portugal e na UE, pode
cair na Lei do Cibercrime.

Mitigação obrigatória:
- **Verificação de propriedade** antes de qualquer verificação além do uptime:
  registo DNS TXT ou ficheiro num caminho conhecido. Sem prova, o site não
  entra em monitorização ativa.
- **Autorização escrita** nos termos de serviço e no contrato de manutenção,
  a identificar explicitamente o tipo de verificações efetuadas.
- **Só reconhecimento passivo.** A plataforma faz pedidos HTTP normais e
  não destrutivos. Não executa exploits, não testa injeção SQL, não faz
  fuzzing, não força autenticação, não tenta contornar WAF ou captcha.
  Reportar uma versão vulnerável não é o mesmo que explorá-la — e só o
  primeiro é aceitável aqui.

## Formulários de teste

A submissão diária de formulários gera entradas reais no CRM e na inbox do
cliente. Mal gerido, isto é motivo de churn.

Mitigação:
- dados de teste inequivocamente identificáveis, com token no corpo da mensagem
- frequência configurável e desativável por formulário
- opção de endpoint de teste dedicado para não poluir a base de dados
- informar o cliente no onboarding, por escrito
- nunca submeter formulários de compra, pagamento, subscrição ou registo

## Comportamento do crawler

Um crawler mal comportado põe o IP da plataforma em blacklists e sobrecarrega
o alojamento do cliente.

Mitigação:
- respeitar `robots.txt` e `crawl-delay`
- `User-Agent` identificável com URL de contacto
- concorrência limitada por host e backoff em 429 e 5xx
- budget de páginas por plano
- espalhar os jobs no tempo para não bater vários sites do mesmo servidor de
  alojamento em simultâneo

## Credenciais e chaves

A plataforma acumula acesso privilegiado a dezenas de sites de clientes. Passa
a ser alvo de alto valor.

Mitigação:
- credenciais cifradas em repouso com chave gerida fora da base de dados
- princípio do menor privilégio: SFTP read-only sempre que suficiente
- tokens do plugin e do agente rotativos, com escopo por site e revogáveis
- todas as ações administrativas em audit log imutável
- 2FA obrigatório para a equipa Jelly
- o plugin e o agente com a menor superfície possível — cada endpoint que
  expomos no site do cliente é uma vulnerabilidade que introduzimos

## RGPD

- submissões de formulários de teste não contêm dados pessoais reais, mas
  screenshots e HTML capturado podem conter dados de terceiros
- política de retenção **implementada** em `packages/db/src/retention.ts`,
  aplicada pelo worker uma vez por dia: execuções, amostras de
  disponibilidade, submissões de formulário e registos de notificação aos 90
  dias; relatórios e problemas já resolvidos aos 24 meses; sessões e tokens no
  instante em que caducam. Um problema em aberto nunca é apagado por idade,
  por mais antigo que seja — continua a ser verdade.

  Screenshots: a política prevê 30 dias e não há nada a apagar, porque as
  capturas do submissor não são guardadas em lado nenhum. Há um teste que
  falha no dia em que alguém as começar a guardar sem acrescentar a limpeza.
- DPA com cada cliente, a identificar a Jelly como subcontratante
- servidores e fornecedores na UE sempre que possível

## Falsos positivos

O maior risco de produto, não de segurança. Uma plataforma que grita todos os
dias é ignorada em duas semanas.

Mitigação:
- confirmação por segunda observação antes de alertar em uptime e links
  externos
- nível de confiança explícito no matching de CVEs por fingerprint externo
- deduplicação de findings por fingerprint, com notificação apenas em mudança
  de estado ou severidade
- janelas de manutenção e baseline aprovada por site
- política de escalonamento: crítico alerta já; médio entra no digest diário;
  baixo fica só no relatório mensal
