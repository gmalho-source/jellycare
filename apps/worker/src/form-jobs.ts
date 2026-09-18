import { request } from '@jellycare/checks'
import type { CheckOutcome, ObservedFinding, Site } from '@jellycare/core'
import { schema, type Database } from '@jellycare/db'
import {
  buildCanaryIdentity,
  buildFillPlan,
  discoverForms,
  discoverSiteForms,
  inferFieldRole,
  isTestable,
  submitForm,
  type DiscoveredSiteForm,
} from '@jellycare/forms'
import type { Browser } from 'playwright'
import { and, desc, eq, inArray } from 'drizzle-orm'

/**
 * Orquestração das rotinas de formulários.
 *
 * Ao contrário das verificações agentless, estas precisam de escrever na base
 * de dados e de um browser, por isso não cabem no contrato `CheckDefinition`.
 * Devolvem `CheckOutcome` para poderem passar pelo mesmo caminho de
 * persistência e reconciliação que todas as outras.
 */

export interface FormJobDeps {
  db: Database
  fetch?: typeof globalThis.fetch
  /** Obtido só quando é preciso: arrancar um browser custa segundos. */
  browser?: () => Promise<Browser>
  now?: Date
}

export interface FormDiscoveryConfig {
  maxPages?: number
  seedPaths?: string[]
  crawlDelayMs?: number
}

/** Nome de cada natureza de formulário, como aparece ao cliente. */
const KIND_LABELS: Record<string, string> = {
  contact: 'Formulário de contacto',
  search: 'Formulário de pesquisa',
  login: 'Formulário de entrada',
  registration: 'Formulário de registo',
  commerce: 'Formulário de compra',
  newsletter: 'Subscrição de newsletter',
  unknown: 'Formulário',
}

function pathOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).pathname
  } catch {
    return pageUrl
  }
}

/**
 * Rótulo do formulário, para quem o lê no painel e no relatório.
 *
 * Diz o que a coisa é e onde está. O texto do botão só entra quando há mais do
 * que um formulário do mesmo tipo na mesma página, que é quando ele deixa de
 * ser ruído e passa a ser a única forma de os distinguir.
 *
 * O seletor nunca aparece: `form:nth-of-type(1)` não significa nada para
 * ninguém fora do código, e é o que sobrava em qualquer formulário sem `id`
 * nem botão declarado — ou seja, na maioria dos formulários modernos.
 */
function formLabel(form: DiscoveredSiteForm, all: readonly DiscoveredSiteForm[]): string {
  const path = pathOf(form.pageUrl)
  const base = `${KIND_LABELS[form.kind] ?? KIND_LABELS.unknown} · ${path}`

  const sameBase = all.filter(
    (other) => other.kind === form.kind && pathOf(other.pageUrl) === path,
  )
  if (sameBase.length < 2) return base

  const qualifier = form.submitText?.trim() || form.selector
  return `${KIND_LABELS[form.kind] ?? KIND_LABELS.unknown} "${qualifier}" · ${path}`
}

function fieldMapOf(form: DiscoveredSiteForm): Record<string, string> {
  const map: Record<string, string> = {}
  for (const field of form.fields) {
    if (field.type === 'hidden' || !field.name) continue
    map[field.name] = inferFieldRole(field)
  }
  return map
}

/**
 * Inventaria os formulários do site.
 *
 * Guarda todos, incluindo os que nunca serão submetidos: o cliente tem de ver
 * no painel que os conhecemos e porque é que ficam de fora.
 */
export async function runFormDiscovery(
  deps: FormJobDeps,
  site: Site,
  config: FormDiscoveryConfig,
): Promise<CheckOutcome> {
  const startedAt = Date.now()
  const now = deps.now ?? new Date()

  const discovery = await discoverSiteForms({
    siteUrl: site.url,
    ...(config.maxPages !== undefined ? { maxPages: config.maxPages } : {}),
    ...(config.seedPaths !== undefined ? { seedPaths: config.seedPaths } : {}),
    ...(config.crawlDelayMs !== undefined ? { crawlDelayMs: config.crawlDelayMs } : {}),
    ...(deps.fetch ? { fetchImpl: deps.fetch } : {}),
  })

  const existing = await deps.db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.siteId, site.id))

  for (const form of discovery.forms) {
    await deps.db
      .insert(schema.forms)
      .values({
        siteId: site.id,
        label: formLabel(form, discovery.forms),
        pageUrl: form.pageUrl,
        selector: form.selector,
        fieldMap: fieldMapOf(form),
        enabled: isTestable(form),
        excluded: !isTestable(form),
        discoveredAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.forms.siteId, schema.forms.pageUrl, schema.forms.selector],
        // `enabled` fica de fora de propósito: se alguém desativou o teste deste
        // formulário, uma redescoberta não o pode reativar pelas costas. Já
        // `excluded` é atualizado sempre, porque um formulário que passou a ser
        // de login tem de deixar de ser submetido imediatamente.
        set: {
          label: formLabel(form, discovery.forms),
          fieldMap: fieldMapOf(form),
          excluded: !isTestable(form),
          discoveredAt: now,
        },
      })
  }

  // Um formulário de contacto que desaparece da página onde estava é um
  // incidente: o cliente deixou de poder receber pedidos por ali.
  const parsedPages = new Set(discovery.parsedPages)
  const stillPresent = new Set(
    discovery.forms.map((form) => `${form.pageUrl}\n${form.selector}`),
  )

  const findings: ObservedFinding[] = []
  for (const known of existing) {
    if (known.excluded || !known.enabled) continue
    // Só se a página foi mesmo analisada: um orçamento esgotado não pode
    // parecer um formulário desaparecido.
    if (!parsedPages.has(known.pageUrl)) continue
    if (stillPresent.has(`${known.pageUrl}\n${known.selector}`)) continue

    findings.push({
      code: 'contact_form_disappeared',
      discriminator: `${known.pageUrl}#${known.selector}`,
      severity: 'high',
      title: 'Formulário de contacto desapareceu da página',
      detail:
        `O "${known.label}" já não existe em ${known.pageUrl}. Se a remoção foi ` +
        'intencional, desative-o no painel; caso contrário, o site deixou de receber pedidos ' +
        'por esta via.',
      evidence: { pageUrl: known.pageUrl, selector: known.selector },
    })
  }

  const contactForms = discovery.forms.filter(isTestable).length

  return {
    status: 'ok',
    findings,
    metrics: {
      formsFound: discovery.forms.length,
      contactForms,
      pagesVisited: discovery.pagesVisited,
      requestsMade: discovery.requestsMade,
    },
    durationMs: Date.now() - startedAt,
  }
}

export interface FormTestConfig {
  canaryDomain?: string
  timeoutMs?: number
}

/**
 * Submete os formulários de contacto com dados canário.
 *
 * A página é relida e o formulário reclassificado antes de cada submissão. Não
 * é desperdício: entre a descoberta e o teste, o formulário pode ter mudado, e
 * submeter contra um retrato antigo é exatamente como se acabaria a preencher
 * um formulário de registo por engano.
 */
export async function runFormTest(
  deps: FormJobDeps,
  site: Site,
  config: FormTestConfig,
): Promise<CheckOutcome> {
  const startedAt = Date.now()
  const now = deps.now ?? new Date()
  const canaryDomain = config.canaryDomain ?? process.env.CANARY_EMAIL_DOMAIN

  if (!canaryDomain) {
    throw new Error('CANARY_EMAIL_DOMAIN não está definido: o teste de formulários precisa dele.')
  }
  if (!deps.browser) {
    throw new Error('O teste de formulários precisa de um browser.')
  }

  const forms = await deps.db
    .select()
    .from(schema.forms)
    .where(
      and(
        eq(schema.forms.siteId, site.id),
        eq(schema.forms.enabled, true),
        eq(schema.forms.excluded, false),
      ),
    )

  const findings: ObservedFinding[] = []
  let tested = 0
  let failed = 0

  if (forms.length === 0) {
    return {
      status: 'ok',
      findings,
      metrics: { formsTested: 0, formsFailed: 0 },
      durationMs: Date.now() - startedAt,
    }
  }

  const browser = await deps.browser()

  for (const stored of forms) {
    let page
    try {
      page = await request(stored.pageUrl, {
        timeoutMs: config.timeoutMs ?? 20_000,
        ...(deps.fetch ? { fetchImpl: deps.fetch } : {}),
      })
    } catch (error) {
      findings.push({
        code: 'form_page_unreachable',
        discriminator: stored.id,
        severity: 'high',
        title: 'A página do formulário está inacessível',
        detail: `Não foi possível obter ${stored.pageUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        evidence: { pageUrl: stored.pageUrl },
      })
      failed++
      continue
    }

    const current = discoverForms(page.body, page.finalUrl).find(
      (candidate) => candidate.selector === stored.selector,
    )

    if (!current) {
      findings.push({
        code: 'contact_form_disappeared',
        discriminator: `${stored.pageUrl}#${stored.selector}`,
        severity: 'high',
        title: 'Formulário de contacto desapareceu da página',
        detail: `O formulário ${stored.selector} já não existe em ${stored.pageUrl}.`,
        evidence: { pageUrl: stored.pageUrl, selector: stored.selector },
      })
      failed++
      continue
    }

    if (!isTestable(current)) {
      // Mudou de natureza desde a descoberta. Marca-se como excluído e não se
      // submete — a regra de nunca submeter o que não é contacto vem primeiro.
      await deps.db
        .update(schema.forms)
        .set({ excluded: true })
        .where(eq(schema.forms.id, stored.id))
      continue
    }

    const canary = buildCanaryIdentity({ siteId: site.id, domain: canaryDomain })
    const plan = buildFillPlan(current, canary)

    const [run] = await deps.db
      .insert(schema.formRuns)
      .values({
        formId: stored.id,
        siteId: site.id,
        canaryToken: canary.token,
        canaryAddress: canary.address,
        startedAt: now,
      })
      .returning({ id: schema.formRuns.id })

    const result = await submitForm({
      browser,
      pageUrl: stored.pageUrl,
      form: current,
      plan,
      timeoutMs: config.timeoutMs ?? 30_000,
      ...(stored.successIndicator ? { successIndicator: stored.successIndicator } : {}),
    })

    tested++

    await deps.db
      .update(schema.formRuns)
      .set({ submitted: result.submitted, submitError: result.reason ?? null })
      .where(eq(schema.formRuns.id, run!.id))

    if (plan.unresolvedRequired.length > 0) {
      findings.push({
        code: 'form_fields_unconfigured',
        discriminator: stored.id,
        severity: 'medium',
        title: 'O formulário tem campos obrigatórios que não sabemos preencher',
        detail:
          `Campos por configurar: ${plan.unresolvedRequired.map((f) => f.name).join(', ')}. ` +
          'Indique que valor usar para cada um no painel, para que o teste possa correr.',
        evidence: { formId: stored.id, fields: plan.unresolvedRequired.map((f) => f.name) },
      })
    }

    if (!result.submitted) {
      failed++
      findings.push({
        code: 'form_submission_failed',
        discriminator: stored.id,
        severity: 'high',
        title: `O formulário "${stored.label}" não aceitou a submissão`,
        detail:
          (result.reason ?? 'Não foi possível confirmar que a submissão foi aceite.') +
          (current.captcha
            ? ` O formulário está protegido por ${current.captcha}; se for esse o bloqueio, ` +
              'adicione o IP das probes à lista de exceções em vez de desativar a proteção.'
            : ''),
        evidence: {
          formId: stored.id,
          pageUrl: stored.pageUrl,
          validationErrors: result.validationErrors,
          captcha: current.captcha ?? null,
        },
      })
    }
  }

  return {
    status: 'ok',
    findings,
    metrics: { formsTested: tested, formsFailed: failed },
    durationMs: Date.now() - startedAt,
  }
}

export interface FormDeliveryConfig {
  /** Tempo dado ao email para chegar antes de se considerar em falta. */
  graceMinutes?: number
  /** Acima disto, a notificação é considerada lenta. */
  slowThresholdMs?: number
}

/**
 * Avalia se as notificações dos formulários chegaram mesmo.
 *
 * Corre separada do teste porque o email demora: esperar por ele dentro da
 * submissão prenderia um worker durante minutos por formulário.
 */
export async function runFormDelivery(
  deps: FormJobDeps,
  site: Site,
  config: FormDeliveryConfig,
): Promise<CheckOutcome> {
  const startedAt = Date.now()
  const now = deps.now ?? new Date()
  const graceMs = (config.graceMinutes ?? 15) * 60_000
  const slowThresholdMs = config.slowThresholdMs ?? 5 * 60_000

  const forms = await deps.db
    .select()
    .from(schema.forms)
    .where(
      and(
        eq(schema.forms.siteId, site.id),
        eq(schema.forms.enabled, true),
        eq(schema.forms.excluded, false),
      ),
    )

  const findings: ObservedFinding[] = []
  let evaluated = 0
  let missing = 0

  if (forms.length === 0) {
    return {
      status: 'ok',
      findings,
      metrics: { runsEvaluated: 0, missingDeliveries: 0 },
      durationMs: Date.now() - startedAt,
    }
  }

  const runs = await deps.db
    .select()
    .from(schema.formRuns)
    .where(
      and(
        eq(schema.formRuns.siteId, site.id),
        inArray(
          schema.formRuns.formId,
          forms.map((form) => form.id),
        ),
      ),
    )
    .orderBy(desc(schema.formRuns.startedAt))
    .limit(200)

  for (const form of forms) {
    // Só a submissão mais recente que já passou o período de graça: avaliar as
    // antigas repetiria findings de problemas entretanto resolvidos.
    const latest = runs.find(
      (run) =>
        run.formId === form.id && now.getTime() - run.startedAt.getTime() >= graceMs,
    )
    if (!latest) continue
    // Uma submissão que nem chegou a passar já é reportada pelo teste; não
    // vale a pena dizer duas vezes que não chegou email.
    if (!latest.submitted) continue

    evaluated++

    if (!latest.emailReceived) {
      missing++
      findings.push({
        code: 'form_email_not_delivered',
        discriminator: form.id,
        severity: 'high',
        title: `O formulário "${form.label}" não gerou notificação por email`,
        detail:
          'A submissão foi aceite pelo site mas não chegou nenhuma mensagem à caixa de ' +
          `verificação em ${Math.round(graceMs / 60_000)} minutos. É o cenário em que o ` +
          'cliente pensa que não tem pedidos quando na verdade não os está a receber.',
        evidence: {
          formId: form.id,
          canaryAddress: latest.canaryAddress,
          submittedAt: latest.startedAt.toISOString(),
        },
      })
      continue
    }

    const risks: string[] = []
    if (latest.spf && latest.spf !== 'pass') risks.push(`SPF ${latest.spf}`)
    if (latest.dkim && latest.dkim !== 'pass') risks.push(`DKIM ${latest.dkim}`)
    if (latest.dmarc && latest.dmarc !== 'pass') risks.push(`DMARC ${latest.dmarc}`)

    if (latest.landedInSpam) {
      findings.push({
        code: 'form_email_in_spam',
        discriminator: form.id,
        severity: 'high',
        title: `As notificações de "${form.label}" estão a cair no spam`,
        detail:
          'A mensagem chegou mas foi classificada como spam. Um funil de contactos que entrega ' +
          'no spam é indistinguível, para o cliente, de um site que não gera pedidos.',
        evidence: { formId: form.id, spf: latest.spf, dkim: latest.dkim, dmarc: latest.dmarc },
      })
    } else if (risks.length > 0) {
      findings.push({
        code: 'form_email_auth_risk',
        discriminator: form.id,
        severity: 'medium',
        title: `As notificações de "${form.label}" não autenticam corretamente`,
        detail:
          `Falhas na autenticação da mensagem recebida: ${risks.join(', ')}. Ainda chega, mas a ` +
          'probabilidade de ir parar ao spam aumenta a cada envio.',
        evidence: { formId: form.id, risks },
      })
    }

    if (latest.deliveryLatencyMs !== null && latest.deliveryLatencyMs > slowThresholdMs) {
      findings.push({
        code: 'form_email_slow',
        discriminator: form.id,
        severity: 'low',
        title: `As notificações de "${form.label}" demoram a chegar`,
        detail: `A última demorou ${Math.round(latest.deliveryLatencyMs / 60_000)} minutos.`,
        evidence: { formId: form.id, latencyMs: latest.deliveryLatencyMs },
      })
    }
  }

  return {
    status: 'ok',
    findings,
    metrics: { runsEvaluated: evaluated, missingDeliveries: missing },
    durationMs: Date.now() - startedAt,
  }
}
