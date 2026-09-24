#!/usr/bin/env node
/**
 * Cria (ou atualiza) o monitor do UptimeRobot sobre o sinal de vida.
 *
 * Porque é que isto é um script e não um clique no site deles: o alarme
 * principal da plataforma não pode viver só na memória de quem o configurou.
 * Assim fica escrito, repetível, e volta a existir igual se alguém o apagar
 * ou se um dia mudarmos de domínio.
 *
 * A chave nunca passa por aqui nem por lado nenhum que não seja o ambiente de
 * quem corre o comando:
 *
 *   UPTIMEROBOT_API_KEY=... node scripts/uptimerobot.mjs
 *
 * Tem de ser a chave **da conta** («Main API key»), e não uma chave de um
 * monitor: as de monitor só leem. Está no painel deles, em «Integrations &
 * API» na barra lateral → API.
 *
 * Opções:
 *   --url        endereço a vigiar (por omissão o de produção)
 *   --nome       nome do monitor
 *   --intervalo  segundos entre verificações (mínimo 300 no plano gratuito)
 *   --contactos  ids de contactos de alerta, separados por vírgula
 *                (por omissão, todos os que a conta tiver)
 *   --confirmar  sem isto, só mostra o que faria
 *   --testar     dispara o alarme de propósito e verifica que ele tocou
 */

const API = process.env.UPTIMEROBOT_API ?? 'https://api.uptimerobot.com/v2'

/** Um endereço que responde sempre 503, para o teste do alarme. */
const SEMPRE_EM_BAIXO = 'https://httpbin.org/status/503'

/** Quanto se espera entre leituras. Encurtável para o próprio teste do script. */
const ESPERA_MS = Number(process.env.UPTIMEROBOT_ESPERA_MS ?? 30_000)

const CHAVE = process.env.UPTIMEROBOT_API_KEY
if (!CHAVE) {
  console.error(
    'Falta UPTIMEROBOT_API_KEY no ambiente.\n' +
      'A chave da conta está em https://dashboard.uptimerobot.com → Integrations & API → API.',
  )
  process.exit(1)
}

function argumento(nome, omissao) {
  const i = process.argv.indexOf(`--${nome}`)
  return i === -1 ? omissao : process.argv[i + 1]
}

const url = argumento('url', 'https://jellycare.pt/api/health/scheduler')
const nome = argumento('nome', 'Jellycare — sinal de vida do agendador')
const intervalo = Number(argumento('intervalo', '300'))
const contactosPedidos = argumento('contactos', '')
const confirmar = process.argv.includes('--confirmar')
const testar = process.argv.includes('--testar')

/** Uma chamada à API deles. Devolve o corpo; rebenta com a mensagem que eles derem. */
async function chamar(metodo, campos = {}) {
  const corpo = new URLSearchParams({ api_key: CHAVE, format: 'json', ...campos })
  const resposta = await fetch(`${API}/${metodo}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' },
    body: corpo,
  })

  const texto = await resposta.text()
  let dados
  try {
    dados = JSON.parse(texto)
  } catch {
    throw new Error(`${metodo}: resposta que não é JSON (HTTP ${resposta.status}): ${texto.slice(0, 200)}`)
  }

  // A API deles responde 200 mesmo quando recusa; o que decide é `stat`.
  if (dados.stat !== 'ok') {
    const erro = dados.error?.message ?? dados.error?.type ?? JSON.stringify(dados.error ?? dados)
    throw new Error(`${metodo}: ${erro}`)
  }
  return dados
}

// Um rasto de pilha não ajuda quem está a configurar um alarme: o que ajuda
// é a frase que a API deles devolveu.
process.on('uncaughtException', (erro) => {
  console.error(String(erro.message ?? erro))
  process.exit(1)
})

const conta = await chamar('getAccountDetails')
console.log(
  `Conta: ${conta.account.email} · ${conta.account.up_monitors + conta.account.down_monitors + conta.account.paused_monitors}/${conta.account.monitor_limit} monitores usados`,
)

if (testar) {
  await testarAlarme()
  process.exit(0)
}

const contactos = await chamar('getAlertContacts')
const escolhidos = contactosPedidos
  ? contactosPedidos.split(',').map((id) => id.trim())
  : contactos.alert_contacts.map((contacto) => String(contacto.id))

if (escolhidos.length === 0) {
  console.error(
    'A conta não tem contactos de alerta. Um monitor sem contacto deteta a avaria e não avisa ninguém —\n' +
      'crie um em Settings → Alert contacts antes de correr isto.',
  )
  process.exit(1)
}

for (const contacto of contactos.alert_contacts) {
  if (escolhidos.includes(String(contacto.id))) {
    console.log(`Avisa: ${contacto.friendly_name} (${contacto.value})`)
  }
}

// `threshold` e `recurrence` a zero: avisa à primeira e não repete.
const alert_contacts = escolhidos.map((id) => `${id}_0_0`).join('-')

const existentes = await chamar('getMonitors', { search: url })
const jaExiste = existentes.monitors.find((monitor) => monitor.url === url)

if (!confirmar) {
  console.log(
    `\n[ensaio] ${jaExiste ? 'Atualizaria' : 'Criaria'} o monitor:\n` +
      `  nome      ${nome}\n` +
      `  url       ${url}\n` +
      `  intervalo ${intervalo}s\n\n` +
      'Volte a correr com --confirmar para o fazer.',
  )
  process.exit(0)
}

const campos = { friendly_name: nome, url, type: '1', interval: String(intervalo), alert_contacts }

const resultado = jaExiste
  ? await chamar('editMonitor', { id: String(jaExiste.id), ...campos })
  : await chamar('newMonitor', campos)

console.log(
  `${jaExiste ? 'Atualizado' : 'Criado'}: monitor ${resultado.monitor.id} sobre ${url}, de ${intervalo / 60} em ${intervalo / 60} minutos.`,
)
console.log(
  'O endpoint responde 503 quando o agendador para ou uma verificação deixa de concluir,\n' +
    'e o UptimeRobot trata um 503 como «em baixo» — é isso que faz o alarme tocar.',
)

/**
 * Dispara o alarme de propósito e verifica que ele tocou.
 *
 * Um alarme que nunca foi disparado à experiência não se sabe se funciona.
 * Este teste aponta o monitor para um endereço que responde sempre 503,
 * espera que o UptimeRobot dê por isso, e volta a pô-lo no sítio.
 *
 * **O endereço é reposto aconteça o que acontecer.** Deixá-lo a apontar para
 * o endereço falso seria desligar o alarme em silêncio, que é pior do que
 * nunca o ter testado — daí o `finally`, e daí o aviso aos gritos se a
 * reposição falhar.
 *
 * Não toca em produção: durante o teste o agendador continua a correr e os
 * sites dos clientes continuam a ser verificados. O que se testa aqui é a
 * outra metade da corrente — a que é do UptimeRobot.
 */
async function testarAlarme() {
  const existentes = await chamar('getMonitors', { search: url })
  const monitor = existentes.monitors.find((m) => m.url === url)

  if (!monitor) {
    console.error(`Não há monitor nenhum sobre ${url}. Crie-o primeiro (sem --testar).`)
    process.exit(1)
  }

  const inicio = Math.floor(Date.now() / 1000)
  console.log(`Monitor ${monitor.id} («${monitor.friendly_name}»), a vigiar ${monitor.url}.`)
  console.log(`A apontá-lo para ${SEMPRE_EM_BAIXO} — o alarme deve tocar dentro de um ciclo.\n`)

  await chamar('editMonitor', { id: String(monitor.id), url: SEMPRE_EM_BAIXO })

  let tocou = false
  try {
    // Vinte e quatro leituras: com a espera normal dá doze minutos. O ciclo
    // mais curto do plano gratuito são cinco, e doze dá margem para um ciclo
    // inteiro mais a fila deles.
    const limite = Date.now() + ESPERA_MS * 24
    while (Date.now() < limite) {
      await new Promise((r) => setTimeout(r, ESPERA_MS))

      const leitura = await chamar('getMonitors', {
        monitors: String(monitor.id),
        logs: '1',
        logs_limit: '10',
      })
      const lido = leitura.monitors[0]
      // `type: 1` é uma paragem. Só contam as posteriores à troca: o
      // histórico pode ter paragens antigas, e dá-las por boas seria o teste
      // a passar sem ter provado nada.
      const paragem = (lido?.logs ?? []).find(
        (registo) => registo.type === 1 && Number(registo.datetime) >= inicio,
      )

      if (paragem) {
        tocou = true
        const quando = new Date(Number(paragem.datetime) * 1000)
        console.log(`O alarme tocou às ${quando.toLocaleTimeString('pt-PT')}.`)
        console.log(`Motivo registado: ${paragem.reason?.detail ?? paragem.reason?.code ?? '—'}`)
        break
      }

      const faltam = Math.round((limite - Date.now()) / 1000)
      console.log(`Ainda nada (estado ${lido?.status}). Mais ${faltam}s de espera.`)
    }
  } finally {
    try {
      await chamar('editMonitor', { id: String(monitor.id), url })
      console.log(`\nEndereço reposto: ${url}`)
    } catch (erro) {
      console.error(
        `\n!!! NÃO CONSEGUI REPOR O ENDEREÇO DO MONITOR !!!\n` +
          `O monitor ${monitor.id} ficou a apontar para ${SEMPRE_EM_BAIXO} e o alarme está,\n` +
          `na prática, desligado. Reponha-o à mão para ${url}.\n` +
          `Erro: ${erro instanceof Error ? erro.message : String(erro)}`,
      )
      process.exitCode = 1
    }
  }

  if (!tocou) {
    console.error(
      'O alarme não tocou dentro do tempo dado. Verifique o intervalo do monitor e se ele\n' +
        'tem contactos de alerta associados — um monitor sem contacto deteta e não avisa.',
    )
    process.exitCode = 1
    return
  }

  console.log('Falta a última confirmação, e essa é sua: veja se o email chegou mesmo.')
}
