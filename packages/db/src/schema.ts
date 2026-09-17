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
