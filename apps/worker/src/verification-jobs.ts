import { verifyOwnershipAny } from '@jellycare/checks'
import { schema, type Database } from '@jellycare/db'
import { and, eq } from 'drizzle-orm'

/**
 * Verificação automática da propriedade dos domínios.
 *
 * O painel promete "verificamos automaticamente de hora a hora" desde o
 * primeiro dia, e não havia nada que o fizesse: o único caminho era o botão.
 * Quem publicava um registo TXT e fechava a janela ficava à espera para
 * sempre, e o site ficava sem as verificações de segurança que dependem da
 * prova.
 *
 * Tenta as duas vias com o mesmo token, como o botão faz. Quem publicou o
 * ficheiro em vez do TXT é apanhado na mesma.
 */

export interface VerificationSweepDeps {
  db: Database
  fetch?: typeof globalThis.fetch
  now?: Date
}

export interface VerificationSweepResult {
  considered: number
  verified: number
  failed: number
}

export async function sweepPendingVerifications(
  deps: VerificationSweepDeps,
): Promise<VerificationSweepResult> {
  const now = deps.now ?? new Date()

  const pending = await deps.db
    .select({
      id: schema.siteVerifications.id,
      token: schema.siteVerifications.token,
      siteId: schema.sites.id,
      hostname: schema.sites.hostname,
      url: schema.sites.url,
      state: schema.sites.state,
    })
    .from(schema.siteVerifications)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.siteVerifications.siteId))
    .where(
      and(
        eq(schema.siteVerifications.state, 'pending'),
        // Um site arquivado não se anda a verificar: já ninguém o quer.
        eq(schema.sites.state, 'onboarding'),
      ),
    )

  let verified = 0
  let failed = 0

  for (const row of pending) {
    let result
    try {
      result = await verifyOwnershipAny(
        { hostname: row.hostname, siteUrl: row.url, token: row.token },
        deps.fetch ? { fetchImpl: deps.fetch } : {},
      )
    } catch (error) {
      // Uma verificação que rebenta não pode levar as outras atrás: a
      // rotina varre todos os sites e um DNS avariado é de um só.
      failed++
      console.warn(
        `[verificação] ${row.hostname}: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }

    await deps.db
      .update(schema.siteVerifications)
      .set({
        lastCheckedAt: now,
        ...(result.verified
          ? { state: 'verified' as const, verifiedAt: now, method: result.method }
          : {}),
      })
      .where(eq(schema.siteVerifications.id, row.id))

    if (!result.verified) {
      failed++
      continue
    }

    await deps.db
      .update(schema.sites)
      .set({ state: 'active' })
      .where(eq(schema.sites.id, row.siteId))

    verified++
    console.info(`[verificação] ${row.hostname}: propriedade confirmada por ${result.method}.`)
  }

  return { considered: pending.length, verified, failed }
}
