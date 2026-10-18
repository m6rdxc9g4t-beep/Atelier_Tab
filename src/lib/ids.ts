import { customAlphabet } from 'nanoid'

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10)

export type IdPrefix = 'ws' | 'proj' | 'tbl' | 'fld' | 'rec' | 'view' | 'opt' | 'usr' | 'flt'

/** Identifiant stable et lisible : `rec_k3j9x0a1bz`. */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${nano()}`
}
