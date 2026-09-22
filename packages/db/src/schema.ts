import { sql } from 'drizzle-orm'
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Bytes em bruto.
 *
 * O PDF de um relatório ronda os 100 kB; uma carteira de cinquenta sites gera
 * cerca de 60 MB por ano. Guardá-lo na base de dados evita uma dependência de
 * armazenamento de objetos numa fase em que ela só acrescentaria peças a
 * manter. Quando o volume o justificar, troca-se este campo por uma chave de
 * S3 sem tocar no resto.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const severityEnum = pgEnum('severity', ['info', 'low', 'medium', 'high', 'critical'])

export const findingStateEnum = pgEnum('finding_state', [
  'pending',
  'open',
  'acknowledged',
  'resolved',
  'ignored',
])

export const checkStatusEnum = pgEnum('check_status', ['ok', 'failed'])

export const verificationMethodEnum = pgEnum('verification_method', ['dns_txt', 'http_file'])

export const verificationStateEnum = pgEnum('verification_state', [
  'pending',
  'verified',
  'failed',
])

export const siteStateEnum = pgEnum('site_state', ['onboarding', 'active', 'paused', 'archived'])

export const notificationChannelEnum = pgEnum('notification_channel', [
  'email',
  'slack',
  'webhook',
])

export const memberRoleEnum = pgEnum('member_role', ['owner', 'admin', 'member', 'client'])

export const legalDocumentKindEnum = pgEnum('legal_document_kind', [
  'dpa',
  'subprocessors',
  'terms',
])

export const legalLocaleEnum = pgEnum('legal_locale', ['pt', 'en'])

/* -------------------------------------------------------------------------- */
/* Tenancy                                                                    */
/* -------------------------------------------------------------------------- */

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  /**
   * Dia do mês em que o relatório do mês anterior é enviado. Nunca o dia 1: o
   * relatório sai depois de os dados assentarem.
   */
  reportSendDay: integer('report_send_day').notNull().default(3),
  /** Marca a apresentar no relatório. Vazio usa a da Jellycare. */
  brandName: text('brand_name'),
  brandUrl: text('brand_url'),
  /**
   * Referência ao DPA negociado em papel, quando existe.
   *
   * Um cliente com departamento jurídico próprio não aceita o nosso modelo
   * num ecrã — manda o dele. Preenchido este campo, o fluxo online de
   * aceitação desliga-se para esta organização e fica aqui a referência ao
   * documento que vale. Sem isto, o primeiro cliente sério ficava bloqueado
   * a olhar para um botão que não podia carregar.
   */
  negotiatedDpaRef: text('negotiated_dpa_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * `client` é o papel do portal: vê apenas os sites da sua organização e não
 * tem acesso a configuração nem a credenciais.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('memberships_org_user_idx').on(table.organizationId, table.userId)],
)

/* -------------------------------------------------------------------------- */
/* Sites                                                                      */
/* -------------------------------------------------------------------------- */

export const sites = pgTable(
  'sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /** URL base canónico, sem barra final. */
    url: text('url').notNull(),
    hostname: text('hostname').notNull(),
    state: siteStateEnum('state').notNull().default('onboarding'),
    /** Stack detetada por fingerprint; informativo na Fase 1. */
    platform: text('platform'),
    /** Texto que tem de aparecer na homepage; um site hackeado responde 200. */
    expectedContent: text('expected_content'),
    /**
     * Intervalos ISO durante os quais não se alerta. Deploys planeados não
     * devem acordar ninguém — mas os findings continuam a ser registados.
     */
    maintenanceWindows: jsonb('maintenance_windows')
      .$type<{ start: string; end: string }[]>()
      .notNull()
      .default([]),
    /** Disponibilidade contratada, em percentagem. */
    slaTarget: real('sla_target').notNull().default(99.9),
    /** Quem recebe o relatório mensal deste site. */
    reportRecipients: jsonb('report_recipients').$type<string[]>().notNull().default([]),
    /**
     * Páginas onde o administrador declara existirem formulários a testar.
     *
     * A descoberta automática continua a inventariar o site, mas deixou de
     * decidir o que se submete: só os formulários que vivem numa destas
     * páginas são preenchidos e enviados. São duas falhas que isto fecha —
     * submeter um formulário que não devia ser submetido, e não testar um
     * formulário real que a heurística não encontrou.
     *
     * Vazio significa que o teste de formulários não corre. É deliberado:
     * preferimos não testar nada a testar o que ninguém mandou.
     */
    formTestUrls: jsonb('form_test_urls').$type<string[]>().notNull().default([]),
    /**
     * Aplicar sozinho as atualizações, dentro da janela de manutenção.
     *
     * Desligado por omissão, e por site. É a única definição desta plataforma
     * que a faz escrever no site de um cliente, por isso não se liga em massa
     * nem por omissão: liga-se site a site, por quem responde por ele.
     *
     * Sem janela de manutenção declarada não corre nada, mesmo ligado — a
     * janela é a autorização, não só o silêncio dos alertas.
     */
    autoUpdate: boolean('auto_update').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sites_org_idx').on(table.organizationId, table.state)],
)

/**
 * Prova de propriedade do domínio. Sem um registo `verified` aqui, o site só
 * pode ser monitorizado em uptime — nenhum check de segurança corre contra um
 * domínio que não provámos ser do cliente. Ver docs/riscos.md.
 */
export const siteVerifications = pgTable(
  'site_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    method: verificationMethodEnum('method').notNull(),
    /** Valor a publicar: conteúdo do TXT ou do ficheiro. */
    token: text('token').notNull(),
    state: verificationStateEnum('state').notNull().default('pending'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('site_verifications_site_idx').on(table.siteId, table.state)],
)

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

export const checkConfigs = pgTable(
  'check_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    checkType: text('check_type').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    intervalMinutes: integer('interval_minutes').notNull(),
    /** Configuração específica do check, validada por Zod no worker. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('check_configs_site_type_idx').on(table.siteId, table.checkType),
    // O scheduler varre esta tabela a cada tick à procura do que está vencido.
    index('check_configs_due_idx').on(table.enabled, table.nextRunAt),
  ],
)

/**
 * Histórico de execuções. Cresce depressa — em produção esta tabela deve ser
 * particionada por mês e os runs sem findings expurgados aos 90 dias, conforme
 * a política de retenção em docs/riscos.md.
 */
/**
 * Ligação de um site a uma ferramenta externa que sabe coisas que nós, de
 * fora, não conseguimos saber.
 *
 * Hoje só existe a WP Umbrella, que já tem o plugin instalado nos sites que a
 * Jelly gere. Escrever um plugin nosso punha um segredo nosso a correr dentro
 * do WordPress de todos os clientes — uma posição de supply chain que não
 * precisamos de ocupar para entregar o que o cliente quer saber.
 *
 * As credenciais não estão aqui. O token é da Jelly, é um só, e vive nos
 * segredos do worker como as outras chaves de API. Esta tabela guarda o
 * mapeamento — que site nosso é que projeto deles — e o estado da última
 * sincronização. No dia em que houver mais do que uma agência, é aqui que
 * entram credenciais cifradas por organização, e não antes: cifra que ainda
 * não é precisa é só mais uma coisa para se fazer mal.
 */
export const connectors = pgTable(
  'connectors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** Por agora `wp_umbrella`. Texto e não enum: o próximo há de vir. */
    type: text('type').notNull(),
    /** O identificador do lado de lá. */
    externalId: text('external_id').notNull(),
    /** Como a ferramenta externa chama a este site, para o painel confirmar a ligação. */
    externalName: text('external_name'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Um site liga-se uma vez a cada ferramenta. Duas ligações à mesma
    // ferramenta seriam duas fontes de verdade para o mesmo inventário.
    uniqueIndex('connectors_site_type_idx').on(table.siteId, table.type),
  ],
)

/**
 * O que está instalado num site WordPress.
 *
 * Substituído por inteiro a cada sincronização: é um retrato, não um
 * histórico. O histórico de que precisamos vive nos findings, que já sabem
 * quando um problema apareceu e quando desapareceu.
 */
export const wpComponents = pgTable(
  'wp_components',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** `plugin`, `theme` ou `core`. */
    kind: text('kind').notNull(),
    /** Identificador estável do lado do WordPress. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    version: text('version'),
    /** Preenchido só quando há atualização por aplicar. */
    latestVersion: text('latest_version'),
    active: boolean('active').notNull().default(true),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('wp_components_site_kind_key_idx').on(table.siteId, table.kind, table.key),
  ],
)

export const checkRuns = pgTable(
  'check_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    checkType: text('check_type').notNull(),
    status: checkStatusEnum('status').notNull(),
    /** Região da probe; o uptime exige confirmação a partir de uma segunda. */
    region: text('region').notNull().default('eu-west'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    error: text('error'),
    /**
     * Correu, mas com menos cobertura do que devia. Ver `CheckOutcome`.
     *
     * Separado do `error` de propósito: um run com avisos teve sucesso, e
     * confundir os dois faria a reconciliação tratá-lo como falhado e deixar
     * de resolver problemas que já não existem.
     */
    warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
    metrics: jsonb('metrics').$type<Record<string, number>>().notNull().default({}),
  },
  (table) => [index('check_runs_site_type_idx').on(table.siteId, table.checkType, table.startedAt)],
)

/* -------------------------------------------------------------------------- */
/* Findings                                                                   */
/* -------------------------------------------------------------------------- */

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    checkType: text('check_type').notNull(),
    /** Identidade estável do problema. Ver `fingerprintOf` em @jellycare/core. */
    fingerprint: text('fingerprint').notNull(),
    code: text('code').notNull(),
    discriminator: text('discriminator'),
    severity: severityEnum('severity').notNull(),
    state: findingStateEnum('state').notNull().default('pending'),
    title: text('title').notNull(),
    detail: text('detail'),
    evidence: jsonb('evidence').$type<Record<string, unknown>>(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    occurrences: integer('occurrences').notNull().default(1),
    /** Quem silenciou ou reconheceu, para o audit trail. */
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  },
  (table) => [
    // A deduplicação não pode depender só da lógica em memória: dois workers
    // a correr o mesmo check em paralelo teriam de colidir aqui.
    uniqueIndex('findings_site_fingerprint_idx').on(table.siteId, table.fingerprint),
    index('findings_site_state_idx').on(table.siteId, table.state, table.severity),
    index('findings_open_idx').on(table.state, table.lastSeenAt),
  ],
)

/* -------------------------------------------------------------------------- */
/* Formulários                                                                */
/* -------------------------------------------------------------------------- */

export const forms = pgTable(
  'forms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    pageUrl: text('page_url').notNull(),
    /** Seletor CSS do formulário na página. */
    selector: text('selector').notNull(),
    /** Mapa campo → valor canário, resolvido em runtime. */
    fieldMap: jsonb('field_map').$type<Record<string, string>>().notNull().default({}),
    /** Texto ou seletor que confirma a submissão. */
    successIndicator: text('success_indicator'),
    /** Onde deve chegar a notificação; vazio salta a validação de email. */
    expectedRecipient: text('expected_recipient'),
    enabled: boolean('enabled').notNull().default(true),
    /**
     * Formulários de compra, registo ou pagamento nunca são submetidos.
     * Marcados aqui para que a descoberta automática não os reative.
     */
    excluded: boolean('excluded').notNull().default(false),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('forms_site_page_selector_idx').on(table.siteId, table.pageUrl, table.selector)],
)

export const formRuns = pgTable(
  'form_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** Token único que identifica esta submissão no email recebido. */
    canaryToken: text('canary_token').notNull().unique(),
    canaryAddress: text('canary_address').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** Nível 1: o formulário aceitou a submissão. */
    submitted: boolean('submitted').notNull().default(false),
    submitError: text('submit_error'),
    /** Nível 2: a notificação chegou à inbox canária. */
    emailReceived: boolean('email_received').notNull().default(false),
    emailReceivedAt: timestamp('email_received_at', { withTimezone: true }),
    deliveryLatencyMs: integer('delivery_latency_ms'),
    /** Nível 3: o email autenticou. Um formulário que entrega no spam é um funil morto. */
    spf: text('spf'),
    dkim: text('dkim'),
    dmarc: text('dmarc'),
    landedInSpam: boolean('landed_in_spam'),
    screenshotKey: text('screenshot_key'),
  },
  (table) => [index('form_runs_form_idx').on(table.formId, table.startedAt)],
)

/* -------------------------------------------------------------------------- */
/* Notificações                                                               */
/* -------------------------------------------------------------------------- */

export const notificationTargets = pgTable(
  'notification_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Nulo = aplica-se a todos os sites da organização. */
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'cascade' }),
    channel: notificationChannelEnum('channel').notNull(),
    /** Email, webhook URL do Slack, ou endpoint genérico. */
    destination: text('destination').notNull(),
    /** Severidade mínima que chega a este destino. */
    minSeverity: severityEnum('min_severity').notNull().default('high'),
    enabled: boolean('enabled').notNull().default(true),
  },
  (table) => [index('notification_targets_org_idx').on(table.organizationId, table.siteId)],
)

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetId: uuid('target_id')
      .notNull()
      .references(() => notificationTargets.id, { onDelete: 'cascade' }),
    findingId: uuid('finding_id').references(() => findings.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    succeeded: boolean('succeeded').notNull(),
    error: text('error'),
  },
  (table) => [index('notification_deliveries_finding_idx').on(table.findingId, table.sentAt)],
)

/* -------------------------------------------------------------------------- */
/* Uptime                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Amostras de disponibilidade, separadas de `check_runs` por serem muito mais
 * frequentes e por alimentarem o cálculo de SLA no relatório mensal.
 */
export const uptimeSamples = pgTable(
  'uptime_samples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    region: text('region').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    up: boolean('up').notNull(),
    statusCode: integer('status_code'),
    responseTimeMs: real('response_time_ms'),
    failureReason: text('failure_reason'),
  },
  (table) => [index('uptime_samples_site_idx').on(table.siteId, table.observedAt)],
)

/* -------------------------------------------------------------------------- */
/* Autenticação                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Ligações de entrada de uso único.
 *
 * Sem palavras-passe: numa ferramenta que guarda acesso privilegiado a dezenas
 * de sites de clientes, cada palavra-passe reutilizada é uma porta aberta.
 * Guarda-se o hash do token, não o token — uma fuga da base de dados não pode
 * dar a ninguém a capacidade de entrar.
 */
export const loginTokens = pgTable(
  'login_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('login_tokens_user_idx').on(table.userId, table.expiresAt)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_user_idx').on(table.userId, table.expiresAt)],
)


/* -------------------------------------------------------------------------- */
/* Relatórios                                                                 */
/* -------------------------------------------------------------------------- */

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    periodYear: integer('period_year').notNull(),
    /** 1 a 12, no fuso do cliente. */
    periodMonth: integer('period_month').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    pdf: bytea('pdf').notNull(),
    fileName: text('file_name').notNull(),
    /** Números-chave, para os mostrar no painel sem reabrir o PDF. */
    highlights: jsonb('highlights')
      .$type<{
        summary: string[]
        uptimePercent: number | null
        slaMet: boolean | null
        incidents: number
        findingsResolved: number
        findingsOpen: number
      }>()
      .notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentTo: jsonb('sent_to').$type<string[]>().notNull().default([]),
    sendError: text('send_error'),
  },
  (table) => [
    // Um relatório por site e por mês. É o que torna a geração idempotente:
    // o job pode correr de hora a hora sem duplicar nada.
    uniqueIndex('reports_site_period_idx').on(table.siteId, table.periodYear, table.periodMonth),
    index('reports_site_idx').on(table.siteId, table.generatedAt),
  ],
)

/**
 * Pedidos manuais de relatório, feitos a partir do painel.
 *
 * O dashboard não pode gerar o PDF: não tem browser, de propósito, para não
 * arrastar um Chromium inteiro para dentro da imagem de quem só serve páginas.
 * Por isso o botão não gera nada — deixa aqui um pedido, e o worker, que tem
 * browser, apanha-o em segundos.
 *
 * Uma tabela e não uma fila: um pedido tem estado que interessa mostrar a
 * quem carregou no botão, e sobrevive a um reinício do worker a meio.
 */
export const reportRequests = pgTable(
  'report_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    /** Quando o worker o reclamou. É isto que impede dois workers de o fazerem. */
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /**
     * O período só é conhecido depois de o worker o resolver.
     *
     * O cálculo do mês anterior tem de respeitar o fuso do cliente e a hora de
     * verão, e essa lógica vive em `@jellycare/reports`. Duplicá-la no
     * dashboard para preencher isto à partida era duplicar exatamente a parte
     * onde é fácil errar.
     */
    periodYear: integer('period_year'),
    periodMonth: integer('period_month'),
    /**
     * Destinatários escolhidos no momento do pedido.
     *
     * Vazio significa "os que estão configurados no site". Serve para enviar
     * o relatório a alguém pontualmente — um contacto novo do cliente, ou o
     * próprio comercial antes de uma reunião — sem mexer na configuração nem
     * passar a mandá-lo para lá todos os meses.
     */
    recipients: jsonb('recipients').$type<string[]>().notNull().default([]),
    /** Para quem o relatório foi enviado, ou vazio se não foi para ninguém. */
    sentTo: jsonb('sent_to').$type<string[]>().notNull().default([]),
    error: text('error'),
  },
  (table) => [
    index('report_requests_site_idx').on(table.siteId, table.requestedAt),
    // Um pedido por site de cada vez. Dois cliques seguidos não geram dois
    // relatórios nem dois emails para o cliente.
    uniqueIndex('report_requests_pending_idx')
      .on(table.siteId)
      .where(sql`completed_at is null`),
  ],
)

/**
 * As cópias de segurança de um site, tal como a ferramenta de manutenção as
 * reporta.
 *
 * Substituídas por inteiro a cada recolha, como o inventário: é um retrato
 * das últimas semanas e não um arquivo. Quem quiser restaurar uma cópia
 * antiga vai à ferramenta; o que aqui interessa é responder a «há cópia
 * recente e está boa?», que é a pergunta que se faz antes de tocar num site
 * e depois de ele partir.
 */
export const wpBackups = pgTable(
  'wp_backups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** Identificador do lado da ferramenta, para não duplicar entre recolhas. */
    externalId: text('external_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** Nulo enquanto decorre — e também quando falha. */
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** `FINISHED`, `ERROR` ou `PENDING`. */
    status: text('status').notNull(),
    /** `AUTOMATIC` quando saiu do agendamento. */
    triggerType: text('trigger_type'),
    /**
     * A versão do WordPress no momento da cópia.
     *
     * É a única via pela qual a conhecemos: a API não expõe a versão do core
     * em mais lado nenhum, e sem ela não se sabe se o core está atrasado.
     */
    wordpressVersion: text('wordpress_version'),
    sizeBytes: integer('size_bytes'),
    errorCode: text('error_code'),
  },
  (table) => [
    uniqueIndex('wp_backups_site_external_idx').on(table.siteId, table.externalId),
    index('wp_backups_site_idx').on(table.siteId, table.startedAt),
  ],
)

/**
 * Cada componente que mandámos atualizar, e o que lhe aconteceu.
 *
 * Ao contrário do inventário e das cópias, isto **não** é um retrato: é o
 * registo do que a plataforma fez ao site de um cliente. Nunca é apagado por
 * uma recolha. É o que responde a «quem mandou atualizar isto, quando, e de
 * que versão para que versão» — a pergunta que se faz no dia em que um site
 * parte, e a que um contrato de serviço gerido obriga a saber responder.
 *
 * O `processId` é o do lote enviado à ferramenta. Várias linhas partilham-no
 * quando foram atualizadas juntas, e é por ele que o resultado é reconciliado
 * mais tarde: a chamada devolve antes de a atualização acabar.
 */
export const wpUpdates = pgTable(
  'wp_updates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** `plugin` ou `theme`. O core não é atualizável pela API. */
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    fromVersion: text('from_version'),
    toVersion: text('to_version'),
    /** Tinha vulnerabilidade conhecida à data em que foi atualizado. */
    vulnerable: boolean('vulnerable').notNull().default(false),
    /** O lote a que pertence, do lado da ferramenta. */
    processId: text('process_id').notNull(),
    /** `pending`, `succeeded`, `failed` ou `unknown`. */
    status: text('status').notNull().default('pending'),
    orderedAt: timestamp('ordered_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    error: text('error'),
  },
  (table) => [
    index('wp_updates_site_idx').on(table.siteId, table.orderedAt),
    index('wp_updates_process_idx').on(table.processId),
  ],
)

/* -------------------------------------------------------------------------- */
/* Documentos legais                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Cada versão publicada de um documento legal, imutável.
 *
 * O corpo é guardado aqui e não lido do repositório em tempo de execução. A
 * pergunta que este modelo tem de saber responder daqui a três anos é «que
 * texto exato é que este cliente aceitou», e um ficheiro no repositório muda
 * com o próximo commit. A linha, uma vez escrita, nunca é alterada: texto
 * novo é versão nova.
 *
 * O `contentHash` existe para que uma alteração silenciosa ao ficheiro de
 * origem seja detetada na sincronização, em vez de passar despercebida.
 */
export const legalDocuments = pgTable(
  'legal_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: legalDocumentKindEnum('kind').notNull(),
    locale: legalLocaleEnum('locale').notNull(),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** SHA-256 do corpo, em hexadecimal. */
    contentHash: text('content_hash').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Quando passa a valer. Uma data no futuro é o pré-aviso da cláusula 7.ª:
     * a lista de subcontratantes nova fica visível e anunciada, mas só
     * substitui a anterior no fim do prazo.
     */
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('legal_documents_kind_locale_version_idx').on(
      table.kind,
      table.locale,
      table.version,
    ),
    index('legal_documents_kind_idx').on(table.kind, table.effectiveAt),
  ],
)

/**
 * Quem aceitou o quê, quando, e de onde.
 *
 * A aceitação é da organização, mas quem carrega no botão é uma pessoa: as
 * duas coisas ficam registadas, porque o artigo 28.º exige contrato com o
 * responsável pelo tratamento e é preciso poder mostrar que quem aceitou
 * tinha poderes para o fazer. `representedBy` guarda o cargo declarado nesse
 * momento, e não o que estiver no perfil hoje.
 */
export const legalAcceptances = pgTable(
  'legal_acceptances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => legalDocuments.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Cargo declarado por quem aceitou, no momento em que aceitou. */
    representedBy: text('represented_by').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (table) => [
    uniqueIndex('legal_acceptances_org_document_idx').on(table.organizationId, table.documentId),
    index('legal_acceptances_org_idx').on(table.organizationId, table.acceptedAt),
  ],
)

/**
 * Oposição a um subcontratante ulterior novo.
 *
 * A cláusula 7.ª promete este direito. Uma promessa contratual sem sítio no
 * produto onde ser exercida é uma promessa que se cumpre por email, mal e
 * tarde — e ninguém consegue depois dizer quantas oposições houve.
 */
export const legalObjections = pgTable(
  'legal_objections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => legalDocuments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('legal_objections_org_idx').on(table.organizationId, table.createdAt)],
)
