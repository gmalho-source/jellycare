/**
 * Que documentos existem, em que versão.
 *
 * Esta lista é a fonte: o texto vive em `documents/` sob controlo de versões,
 * onde é revisto como código, e a sincronização copia cada versão nova para a
 * base de dados, onde fica imutável. Publicar é fazer deploy.
 *
 * **A versão sobe à mão, de propósito.** Se fosse derivada do conteúdo, uma
 * vírgula corrigida obrigava todos os clientes a aceitar outra vez o mesmo
 * acordo. Quem altera o texto é que decide se a alteração é material. A
 * sincronização protege o outro lado do erro: se o ficheiro mudar sem a
 * versão subir, ela recusa-se a continuar em vez de reescrever um documento
 * que alguém já aceitou.
 */

export type LegalKind = 'dpa' | 'subprocessors' | 'terms'
export type LegalLocale = 'pt' | 'en'

export interface LegalDocumentSpec {
  kind: LegalKind
  locale: LegalLocale
  version: number
  title: string
  /** Nome do ficheiro em `documents/`. */
  file: string
  /**
   * Quando esta versão passa a vigorar. Ausente significa «à publicação».
   *
   * Uma data no futuro é o pré-aviso da cláusula 7.ª. Para acrescentar um
   * subcontratante: subir a versão do documento `subprocessors`, escrever
   * aqui uma data a 30 dias, e fazer deploy. O aviso e a contagem saem daqui.
   */
  effectiveAt?: string
}

/**
 * Os documentos que o cliente tem de aceitar para a organização ficar em
 * conformidade. A lista de subcontratantes não entra: é anexo do DPA e
 * notifica-se, não se aceita separadamente.
 */
export const ACCEPTANCE_REQUIRED: readonly LegalKind[] = ['dpa']

export const LEGAL_DOCUMENTS: readonly LegalDocumentSpec[] = [
  {
    kind: 'dpa',
    locale: 'pt',
    // v2: acrescenta as cláusulas 4.ª-A e 4.ª-B. A plataforma deixou de só
    // observar e passa a executar manutenção, o que é alteração material do
    // corpo do acordo — logo, nova aceitação por todos os clientes.
    version: 2,
    title: 'Acordo de Subcontratação de Tratamento de Dados Pessoais',
    file: 'dpa.pt.md',
  },
  {
    kind: 'dpa',
    locale: 'en',
    version: 2,
    title: 'Data Processing Agreement',
    file: 'dpa.en.md',
  },
  {
    kind: 'subprocessors',
    locale: 'pt',
    version: 1,
    title: 'Subcontratantes ulteriores',
    file: 'subprocessors.pt.md',
  },
  {
    kind: 'subprocessors',
    locale: 'en',
    version: 1,
    title: 'Sub-processors',
    file: 'subprocessors.en.md',
  },
  // `terms` está no enum e não tem documento. Os Termos & Condições regulam o
  // negócio — preço, prazos, SLA, rescisão — e essas são decisões da Jelly,
  // não deste repositório. Quando existirem, entram aqui e passam a ser
  // exigidos acrescentando 'terms' a ACCEPTANCE_REQUIRED. O mecanismo já os
  // suporta.
]
