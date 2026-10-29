'use server'

import {
  REPOSITORIO_GITHUB,
  familiaClaudeResolve,
} from '@jellycare/core'
import {
  anularPedidoAoClaude,
  concluirPedidoAoClaude,
  definirRepositorio,
  registarAtividadeSemFalhar,
  reservarPedidoAoClaude,
  schema,
} from '@jellycare/db'
import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { appOrigin } from '@/lib/app-url'
import { GitHubError, abrirIssue, claudeResolveConfigurado, montarIssue } from '@/lib/claude-resolve'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/session'

export interface EstadoClaudeResolve {
  message?: string
  error?: string
  issueUrl?: string
}

/**
 * Leva um problema ao Claude Resolve: abre a issue no repositório do site.
 *
 * Só a Equipa Jelly. O botão põe o Claude a trabalhar num repositório com as
 * credenciais de um cliente; não é coisa para um papel de equipa numa
 * organização, nem, muito menos, para um cliente.
 */
export async function pedirAoClaudeAction(
  _anterior: EstadoClaudeResolve,
  formData: FormData,
): Promise<EstadoClaudeResolve> {
  const user = await requireStaff()
  const findingId = z.string().uuid().safeParse(formData.get('findingId'))
  if (!findingId.success) return { error: 'Problema inválido.' }

  const db = getDb()
  const [linha] = await db
    .select({ finding: schema.findings, site: schema.sites })
    .from(schema.findings)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.findings.siteId))
    .where(and(eq(schema.findings.id, findingId.data), inArray(schema.findings.state, ['open', 'acknowledged'])))
    .limit(1)
  if (!linha) return { error: 'Este problema já não está aberto.' }

  const { finding, site } = linha
  if (!familiaClaudeResolve(finding.code)) return { error: 'O Claude Resolve ainda não trata este tipo de problema.' }
  if (!site.githubRepo) return { error: 'Este site ainda não tem repositório. Ligue-o nas definições do site.' }
  if (!claudeResolveConfigurado()) {
    return { error: 'Falta o GITHUB_RESOLVE_TOKEN nos segredos do dashboard. Ver docs/claude-resolve.md.' }
  }

  const reserva = await reservarPedidoAoClaude(db, {
    findingId: finding.id,
    siteId: site.id,
    repo: site.githubRepo,
    requestedBy: user.id,
  })
  if (!reserva) return { error: 'Este problema já foi enviado ao Claude.' }

  try {
    const issue = await abrirIssue(
      site.githubRepo,
      montarIssue(
        finding,
        { label: site.label, url: site.url, hostname: site.hostname, platform: site.platform },
        `${appOrigin()}/sites/${site.id}/problemas`,
      ),
    )
    await concluirPedidoAoClaude(db, reserva, issue)
    await registarAtividadeSemFalhar(db, {
      siteId: site.id,
      findingId: finding.id,
      tipo: 'claude_resolve_pedido',
      actorId: user.id,
      dados: {
        titulo: finding.title,
        codigo: finding.code,
        severidade: finding.severity,
        issue: { numero: issue.number, url: issue.url, repositorio: site.githubRepo },
      },
    })
    revalidatePath(`/sites/${site.id}/problemas`)
    return { message: `Enviado ao Claude: issue #${issue.number}.`, issueUrl: issue.url }
  } catch (error) {
    await anularPedidoAoClaude(db, reserva)
    if (error instanceof GitHubError) return { error: error.message }
    console.error('[jellycare] Claude Resolve: falha ao abrir a issue', error)
    return { error: 'Não foi possível abrir a issue no GitHub. Tente mais tarde.' }
  }
}

/** O repositório do site, `dono/nome`. Vazio desliga o Claude Resolve neste site. */
export async function definirRepositorioAction(
  _anterior: EstadoClaudeResolve,
  formData: FormData,
): Promise<EstadoClaudeResolve> {
  await requireStaff()
  const dados = z
    .object({
      siteId: z.string().uuid(),
      repo: z
        .string()
        .trim()
        .transform((valor) => valor.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, ''))
        .refine((valor) => valor === '' || REPOSITORIO_GITHUB.test(valor), 'Indique o repositório como dono/nome, por exemplo jelly-pt/site-acpa.'),
    })
    .safeParse({ siteId: formData.get('siteId'), repo: formData.get('repo') ?? '' })
  if (!dados.success) return { error: dados.error.issues[0]?.message ?? 'Dados inválidos.' }

  await definirRepositorio(getDb(), dados.data.siteId, dados.data.repo || null)
  revalidatePath(`/sites/${dados.data.siteId}`, 'layout')
  return {
    message: dados.data.repo ? `Ligado a ${dados.data.repo}.` : 'Repositório desligado. O Claude Resolve deixa de aparecer neste site.',
  }
}
