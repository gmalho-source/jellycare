import { describe, expect, it } from 'vitest'
import { lateAfterMinutes, summariseLiveness, type TrackedConfig } from './scheduler-health'

const AGORA = new Date('2026-09-22T12:00:00Z')

function minutosAtras(minutos: number): Date {
  return new Date(AGORA.getTime() - minutos * 60_000)
}

const UPTIME: TrackedConfig = { siteId: 'a', checkType: 'uptime', intervalMinutes: 5 }
const TLS: TrackedConfig = { siteId: 'a', checkType: 'tls', intervalMinutes: 1440 }

describe('lateAfterMinutes', () => {
  it('dá vinte minutos a um check de cinco em cinco', () => {
    // Folga que chega para um deploy ou uma rajada de recuperação, e não
    // chega para uma avaria passar a noite.
    expect(lateAfterMinutes(5)).toBe(20)
  })

  it('dá quase dois dias a um check diário', () => {
    expect(lateAfterMinutes(1440)).toBe(2890)
  })

  it('não rebenta com um intervalo de zero', () => {
    expect(lateAfterMinutes(0)).toBe(12)
  })
})

describe('summariseLiveness', () => {
  it('não conta um check que nunca teve sucesso', () => {
    // Um tipo novo — o `page_speed` esteve assim o dia todo — é um problema de
    // configuração, não de vivacidade. Marcá-lo como atrasado faria o alarme
    // disparar em cada tipo que acrescentássemos, e um alarme assim ensina-se
    // a ignorar.
    expect(summariseLiveness([UPTIME], [], AGORA)).toEqual([])
  })

  it('dá por bom o que correu dentro da tolerância', () => {
    const resumo = summariseLiveness(
      [UPTIME],
      [{ siteId: 'a', checkType: 'uptime', at: minutosAtras(12) }],
      AGORA,
    )

    expect(resumo).toHaveLength(1)
    expect(resumo[0]?.late).toBe(0)
    expect(resumo[0]?.tracked).toBe(1)
  })

  it('marca como atrasado o que passou a tolerância', () => {
    const resumo = summariseLiveness(
      [UPTIME],
      [{ siteId: 'a', checkType: 'uptime', at: minutosAtras(90) }],
      AGORA,
    )

    expect(resumo[0]?.late).toBe(1)
    expect(resumo[0]?.worstLateMinutes).toBe(90)
  })

  it('a tolerância é por tipo e não global', () => {
    // O mesmo atraso de duas horas: grave no uptime, normal no diário.
    const ha2h = minutosAtras(120)
    const resumo = summariseLiveness(
      [UPTIME, { ...TLS, siteId: 'a' }],
      [
        { siteId: 'a', checkType: 'uptime', at: ha2h },
        { siteId: 'a', checkType: 'tls', at: ha2h },
      ],
      AGORA,
    )

    expect(resumo.find((r) => r.checkType === 'uptime')?.late).toBe(1)
    expect(resumo.find((r) => r.checkType === 'tls')?.late).toBe(0)
  })

  it('agrega os sites e guarda o pior atraso', () => {
    const resumo = summariseLiveness(
      [UPTIME, { ...UPTIME, siteId: 'b' }, { ...UPTIME, siteId: 'c' }],
      [
        { siteId: 'a', checkType: 'uptime', at: minutosAtras(5) },
        { siteId: 'b', checkType: 'uptime', at: minutosAtras(60) },
        { siteId: 'c', checkType: 'uptime', at: minutosAtras(200) },
      ],
      AGORA,
    )

    expect(resumo[0]).toMatchObject({ tracked: 3, late: 2, worstLateMinutes: 200 })
    // O sucesso mais recente de qualquer site: prova que alguma coisa ainda
    // funciona, e distingue «um site parado» de «o check todo parado».
    expect(resumo[0]?.lastSuccessAt).toEqual(minutosAtras(5))
  })

  it('põe os atrasados à frente, e o pior primeiro', () => {
    const resumo = summariseLiveness(
      [UPTIME, { ...TLS, siteId: 'a' }, { siteId: 'a', checkType: 'email_auth', intervalMinutes: 60 }],
      [
        { siteId: 'a', checkType: 'uptime', at: minutosAtras(2) },
        { siteId: 'a', checkType: 'tls', at: minutosAtras(9000) },
        { siteId: 'a', checkType: 'email_auth', at: minutosAtras(500) },
      ],
      AGORA,
    )

    // É a ordem por que se lê quando alguma coisa está mal.
    expect(resumo.map((r) => r.checkType)).toEqual(['tls', 'email_auth', 'uptime'])
  })

  it('ignora um site que não tem o check configurado', () => {
    // Uma execução antiga de um check entretanto desligado não pode ressuscitar
    // como atraso.
    const resumo = summariseLiveness(
      [UPTIME],
      [
        { siteId: 'a', checkType: 'uptime', at: minutosAtras(3) },
        { siteId: 'z', checkType: 'uptime', at: minutosAtras(9000) },
      ],
      AGORA,
    )

    expect(resumo[0]?.tracked).toBe(1)
    expect(resumo[0]?.late).toBe(0)
  })
})
