'use server'

import { organizationLegalState, recordAcceptance, recordObjection } from '@jellycare/db'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db'
import { requireUser } from '@/lib/session'

export type LegalActionState = { error?: string; message?: string }

/**
 * Quem pode aceitar por uma organização.
 *
 * O responsável pelo tratamento é o cliente; a Jelly é a subcontratante. Um
 * acordo do artigo 28.º aceite pela Jelly em nome do cliente é a Jelly a
 * contratar consigo própria, e como prova não vale nada. Por isso o botão só
 * existe para quem tem o papel `client` na organização — e é também por isso
 * que o ecrã vive no portal e não no painel interno.
 */
function podeAceitar(
  user: { memberships: { organizationId: string; role: string }[] },
  organizationId: string,
): boolean {
  return user.memberships.some(
    (m) => m.organizationId === organizationId && m.role === 'client',
  )
}

const aceitacao = z.object({
  organizationId: z.string().uuid(),
  documentIds: z.array(z.string().uuid()).min(1),
  representedBy: z.string().trim().min(2, 'Indique o cargo com que aceita.').max(120),
  confirma: z.literal('on', {
    errorMap: () => ({ message: 'Confirme que tem poderes para vincular a empresa.' }),
  }),
})

export async function acceptLegalDocumentsAction(
  _previous: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  const user = await requireUser()

  const parsed = aceitacao.safeParse({
    organizationId: formData.get('organizationId'),
    documentIds: formData.getAll('documentId'),
    representedBy: formData.get('representedBy'),
    confirma: formData.get('confirma'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  if (!podeAceitar(user, parsed.data.organizationId)) {
    return { error: 'Só um representante do cliente pode aceitar este acordo.' }
  }

  // Confirma que os documentos apresentados são mesmo os que faltam. Sem
  // isto, um pedido forjado registava a aceitação de uma versão antiga, ou
  // de um documento de outro tipo, a partir de um formulário adulterado.
  const estado = await organizationLegalState(getDb(), parsed.data.organizationId)
  const emFalta = new Set(estado.missing.map((documento) => documento.id))
  const pedidos = parsed.data.documentIds.filter((id) => emFalta.has(id))
  if (pedidos.length !== emFalta.size) {
    return { error: 'O acordo mudou entretanto. Recarregue a página e leia a versão atual.' }
  }

  const cabecalhos = await headers()
  await recordAcceptance(getDb(), {
    organizationId: parsed.data.organizationId,
    documentIds: pedidos,
    userId: user.id,
    representedBy: parsed.data.representedBy,
    // `x-forwarded-for` traz a cadeia de proxies; o primeiro endereço é o de
    // quem fez o pedido.
    ip: cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: cabecalhos.get('user-agent'),
  })

  revalidatePath('/portal')
  revalidatePath('/legal/aceitar')
  return { message: 'Aceite. O comprovativo fica disponível abaixo.' }
}

const oposicao = z.object({
  organizationId: z.string().uuid(),
  documentId: z.string().uuid(),
  reason: z.string().trim().min(10, 'Diga em duas linhas qual é o motivo.').max(2000),
})

export async function objectToSubprocessorAction(
  _previous: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  const user = await requireUser()

  const parsed = oposicao.safeParse({
    organizationId: formData.get('organizationId'),
    documentId: formData.get('documentId'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  if (!podeAceitar(user, parsed.data.organizationId)) {
    return { error: 'Só um representante do cliente se pode opor.' }
  }

  await recordObjection(getDb(), { ...parsed.data, userId: user.id })

  revalidatePath('/legal/aceitar')
  return {
    message:
      'Oposição registada. Entramos em contacto antes de a alteração entrar em vigor.',
  }
}
