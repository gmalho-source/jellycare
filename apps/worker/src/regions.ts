/**
 * Que região é esta instância do worker, e que papel tem.
 *
 * Uma região só (o caso de hoje): tudo como sempre — uma fila, um worker, o
 * agendador, os relatórios e a retenção na mesma máquina.
 *
 * Várias regiões (`JELLYCARE_REGIONS=eu-central,eu-south`): cada verificação de
 * disponibilidade é enfileirada uma vez por região, cada uma na fila da sua
 * região (`uptime-<região>`). Antes, duas instâncias partilhavam a mesma fila e
 * cada job ia parar a uma delas ao acaso — a segunda opinião em que a
 * corroboração assenta só existia quando calhava.
 *
 * A primeira região da lista é a principal: corre o agendador, as restantes
 * verificações, os relatórios, a retenção e a sincronização dos documentos. As
 * outras são só probes de disponibilidade. De propósito: uma probe secundária
 * que corresse também as verificações de segurança ia bater nos mesmos
 * ficheiros sensíveis e acabar na mesma lista negra da firewall do alojador —
 * e passava a haver dois IPs a pôr em lista branca em vez de um.
 */

export interface RegionTopology {
  /** A região desta instância. */
  region: string
  /** Todas as regiões em funcionamento, a principal primeiro. */
  regions: string[]
  /** Esta instância corre o agendador e as verificações que não são de uptime. */
  primary: boolean
  /** Há mais do que uma região: o uptime sai por filas próprias. */
  multiRegion: boolean
}

/**
 * Os nomes por omissão das regiões do Fly que usamos.
 *
 * `fra` é `eu-central` porque é esse o nome que as amostras de Frankfurt já
 * têm gravado: mudá-lo partia a série de cada site em duas.
 */
const FLY_REGION_NAMES: Record<string, string> = {
  fra: 'eu-central',
  mad: 'eu-south',
  ams: 'eu-west',
}

/** O BullMQ recusa `:` nos nomes das filas; o resto fica curto e legível. */
const REGION_NAME = /^[a-z0-9][a-z0-9-]{0,30}$/

export function resolveTopology(env: Record<string, string | undefined>): RegionTopology {
  const fly = env['FLY_REGION']?.trim()
  const region =
    env['JELLYCARE_REGION']?.trim() ||
    (fly ? (FLY_REGION_NAMES[fly] ?? `fly-${fly}`) : '') ||
    'eu-west'

  const listed = (env['JELLYCARE_REGIONS'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  const regions = listed.length > 0 ? [...new Set(listed)] : [region]

  for (const name of regions) {
    if (!REGION_NAME.test(name)) {
      throw new Error(
        `Nome de região inválido em JELLYCARE_REGIONS: «${name}». ` +
          'Só minúsculas, números e hífenes.',
      )
    }
  }

  // Uma instância cuja região não está na lista não tem fila de onde ler o
  // uptime e nunca seria a principal: trabalharia em silêncio para nada.
  if (!regions.includes(region)) {
    throw new Error(
      `A região desta instância (${region}) não está em JELLYCARE_REGIONS (${regions.join(', ')}).`,
    )
  }

  return {
    region,
    regions,
    primary: region === regions[0],
    multiRegion: regions.length > 1,
  }
}
