/**
 * Quando sai o relatório agendado: no primeiro dia útil do mês, a partir das
 * nove da manhã, no fuso do cliente.
 *
 * Dia útil é de segunda a sexta e fora dos feriados nacionais. Um relatório a
 * 1 de novembro, feriado, ou num sábado, chega a uma caixa que ninguém abre e
 * fica soterrado pelo que entra na segunda-feira.
 *
 * As nove da manhã servem duas coisas: o email chega em horário de trabalho, e
 * os dados do último dia do mês têm a noite para assentar (a avaliação de
 * entrega das últimas submissões de formulário, nomeadamente).
 */

export const HORA_DE_ENVIO = 9

/** Domingo de Páscoa, pelo algoritmo de Meeus/Jones/Butcher (calendário gregoriano). */
export function domingoDePascoa(ano: number): { mes: number; dia: number } {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return { mes, dia }
}

/** Mês e dia a uma distância em dias de outro, no mesmo ano. */
function mais(ano: number, mes: number, dia: number, dias: number): string {
  const data = new Date(Date.UTC(ano, mes - 1, dia + dias))
  return `${data.getUTCMonth() + 1}-${data.getUTCDate()}`
}

/**
 * Os feriados nacionais obrigatórios em Portugal, como `mês-dia`.
 *
 * Sem o Carnaval, que não é obrigatório, e sem os municipais, que dependem de
 * onde está o cliente.
 */
export function feriadosNacionais(ano: number): Set<string> {
  const pascoa = domingoDePascoa(ano)
  return new Set([
    '1-1', // Ano Novo
    mais(ano, pascoa.mes, pascoa.dia, -2), // Sexta-feira Santa
    `${pascoa.mes}-${pascoa.dia}`, // Páscoa
    '4-25', // Dia da Liberdade
    '5-1', // Dia do Trabalhador
    mais(ano, pascoa.mes, pascoa.dia, 60), // Corpo de Deus
    '6-10', // Dia de Portugal
    '8-15', // Assunção de Nossa Senhora
    '10-5', // Implantação da República
    '11-1', // Todos os Santos
    '12-1', // Restauração da Independência
    '12-8', // Imaculada Conceição
    '12-25', // Natal
  ])
}

/** O primeiro dia útil de um mês, de 1 a 31. */
export function primeiroDiaUtil(ano: number, mes: number): number {
  const feriados = feriadosNacionais(ano)
  for (let dia = 1; ; dia++) {
    const semana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()
    if (semana === 0 || semana === 6) continue
    if (feriados.has(`${mes}-${dia}`)) continue
    return dia
  }
}

/**
 * Já chegou a hora de enviar o relatório do mês anterior?
 *
 * Verdade a partir das nove do primeiro dia útil, e daí até ao fim do mês: um
 * worker que esteve parado nessa manhã envia quando voltar, em vez de esperar
 * pelo mês seguinte.
 */
export function horaDoRelatorio(instante: Date, timeZone: string): boolean {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante)
  const valor = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value)

  const dia = valor('day')
  const util = primeiroDiaUtil(valor('year'), valor('month'))
  if (dia !== util) return dia > util
  return valor('hour') >= HORA_DE_ENVIO
}
