import type { NotificationTarget, RenderedNotification } from './notifications.js'

export interface DeliveryOutcome {
  targetId: string
  succeeded: boolean
  error?: string
}

export interface Notifier {
  send(target: NotificationTarget, rendered: RenderedNotification): Promise<DeliveryOutcome>
}

export interface ChannelConfig {
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
  resendApiKey?: string
  fromEmail?: string
}

async function post(
  url: string,
  body: unknown,
  options: { fetchImpl: typeof globalThis.fetch; timeoutMs: number; headers?: Record<string, string> },
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    return await options.fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify(body),
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Envio por email, Slack e webhook.
 *
 * Uma falha de entrega nunca propaga: o run do check já foi persistido e os
 * findings já estão registados. Perder um alerta é mau, mas perder o registo
 * do problema porque o Slack esteve em baixo seria pior.
 */
export class MultiChannelNotifier implements Notifier {
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly timeoutMs: number

  constructor(private readonly config: ChannelConfig = {}) {
    this.fetchImpl = config.fetch ?? globalThis.fetch
    this.timeoutMs = config.timeoutMs ?? 10_000
  }

  async send(
    target: NotificationTarget,
    rendered: RenderedNotification,
  ): Promise<DeliveryOutcome> {
    try {
      switch (target.channel) {
        case 'email':
          await this.sendEmail(target.destination, rendered)
          break
        case 'slack':
          await this.sendSlack(target.destination, rendered)
          break
        case 'webhook':
          await this.sendWebhook(target.destination, rendered)
          break
      }
      return { targetId: target.id, succeeded: true }
    } catch (error) {
      return {
        targetId: target.id,
        succeeded: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async sendEmail(to: string, rendered: RenderedNotification): Promise<void> {
    if (!this.config.resendApiKey) {
      throw new Error('Envio por email não configurado: falta RESEND_API_KEY')
    }

    const response = await post(
      'https://api.resend.com/emails',
      {
        from: this.config.fromEmail ?? 'Jellycare <alertas@jellycare.pt>',
        to: [to],
        subject: rendered.subject,
        text: rendered.text,
      },
      {
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
        headers: { authorization: `Bearer ${this.config.resendApiKey}` },
      },
    )

    if (!response.ok) {
      throw new Error(`Resend respondeu ${response.status}: ${await response.text()}`)
    }
  }

  private async sendSlack(webhookUrl: string, rendered: RenderedNotification): Promise<void> {
    const response = await post(
      webhookUrl,
      { text: rendered.subject, blocks: rendered.slackBlocks },
      { fetchImpl: this.fetchImpl, timeoutMs: this.timeoutMs },
    )

    if (!response.ok) throw new Error(`Slack respondeu ${response.status}`)
  }

  private async sendWebhook(url: string, rendered: RenderedNotification): Promise<void> {
    const response = await post(
      url,
      { subject: rendered.subject, text: rendered.text },
      { fetchImpl: this.fetchImpl, timeoutMs: this.timeoutMs },
    )

    if (!response.ok) throw new Error(`Webhook respondeu ${response.status}`)
  }
}

/** Notificador que só regista, para desenvolvimento e testes. */
export class RecordingNotifier implements Notifier {
  readonly sent: { target: NotificationTarget; rendered: RenderedNotification }[] = []

  async send(
    target: NotificationTarget,
    rendered: RenderedNotification,
  ): Promise<DeliveryOutcome> {
    this.sent.push({ target, rendered })
    return { targetId: target.id, succeeded: true }
  }
}

export interface ReportEmail {
  to: string[]
  subject: string
  text: string
  attachment: { filename: string; content: Buffer }
}

/**
 * Envio do relatório mensal com o PDF anexado.
 *
 * Separado do notificador de alertas porque tem outra forma: um destinatário
 * que recebe um relatório não está a ser interrompido, está a receber um
 * entregável.
 */
export function createReportSender(config: ChannelConfig = {}) {
  const fetchImpl = config.fetch ?? globalThis.fetch
  const timeoutMs = config.timeoutMs ?? 30_000

  return async (message: ReportEmail): Promise<void> => {
    if (!config.resendApiKey) {
      throw new Error('Envio do relatório não configurado: falta RESEND_API_KEY')
    }

    const response = await post(
      'https://api.resend.com/emails',
      {
        from: config.fromEmail ?? 'Jellycare <relatorios@jellycare.pt>',
        to: message.to,
        subject: message.subject,
        text: message.text,
        attachments: [
          {
            filename: message.attachment.filename,
            content: message.attachment.content.toString('base64'),
          },
        ],
      },
      { fetchImpl, timeoutMs, headers: { authorization: `Bearer ${config.resendApiKey}` } },
    )

    if (!response.ok) {
      throw new Error(`Resend respondeu ${response.status}: ${await response.text()}`)
    }
  }
}
