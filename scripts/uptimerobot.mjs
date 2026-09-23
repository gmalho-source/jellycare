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
 * Tem de ser a chave **da conta** («Main API key», em Settings → API), e não
 * uma chave de um monitor: as chaves de monitor só leem.
 *
 * Opções:
 *   --url        endereço a vigiar (por omissão o de produção)
 *   --nome       nome do monitor
 *   --intervalo  segundos entre verificações (mínimo 300 no plano gratuito)
 *   --contactos  ids de contactos de alerta, separados por vírgula
 *                (por omissão, todos os que a conta tiver)
 *   --confirmar  sem isto, só mostra o que faria
 */

const API = 'https://api.uptimerobot.com/v2'

const CHAVE = process.env.UPTIMEROBOT_API_KEY
if (!CHAVE) {
  console.error(
    'Falta UPTIMEROBOT_API_KEY no ambiente.\n' +
      'A chave da conta está em https://dashboard.uptimerobot.com → Settings → API.',
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
