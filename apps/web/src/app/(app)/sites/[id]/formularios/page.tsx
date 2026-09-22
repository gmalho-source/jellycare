import { notFound } from 'next/navigation'
import { MAX_FORM_TEST_URLS } from '@jellycare/db'
import { Card, CardHeader, EmptyState } from '@/components/ui'
import { getSiteDetail } from '@/lib/queries'
import { assertMembership, canManage, requireUser } from '@/lib/session'
import { FormUrlsPanel } from '../form-urls-panel'

export const dynamic = 'force-dynamic'

export default async function FormulariosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const detail = await getSiteDetail(id)
  if (!detail) notFound()
  assertMembership(user, detail.site.organizationId)
  const manageable = canManage(user, detail.site.organizationId)

  return (
    <Card>
      <CardHeader title="Formulários" />
          {detail.forms.length === 0 ? (
            <EmptyState>
              Nenhum formulário descoberto ainda. São detetados durante a análise do site.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-ink-100">
              {detail.forms.map((form) => (
                <li key={form.id} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink-900">{form.label}</span>
                    <span className="shrink-0 text-xs text-ink-400">
                      {form.excluded
                        ? 'Não submetido'
                        : form.enabled
                          ? 'Em teste'
                          : 'Página não declarada'}
                    </span>
                  </div>
                  <span className="mt-0.5 block truncate text-xs text-ink-400">
                    {form.pageUrl}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <FormUrlsPanel
            siteId={detail.site.id}
            urls={detail.site.formTestUrls}
            maxUrls={MAX_FORM_TEST_URLS}
            suggestions={[
              ...new Set(
                detail.forms.filter((form) => !form.excluded).map((form) => form.pageUrl),
              ),
            ]}
            canManage={manageable}
          />
        </Card>
  )
}
