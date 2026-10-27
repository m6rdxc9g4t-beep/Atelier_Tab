/**
 * Fonctions d'information et de logique (ESTVIDE, ESTNUM, ESTERREUR, SI.NON.DISP,
 * SI.CONDITIONS, SI.MULTIPLE, OUX…). Les erreurs reçues en argument sont des valeurs :
 * ESTERREUR(1/0) vaut VRAI.
 */
import { compareValues, toBoolean } from './coerce'
import { flatten, scalarOf, type FunctionSpec } from './function-args'
import { err, isError, type CellValue } from './values'

type Impl = FunctionSpec['impl']

function is(test: (v: CellValue) => boolean): Impl {
  return (args) => test(scalarOf(args[0] ?? null))
}

const ifna: Impl = (args) => {
  const v = scalarOf(args[0] ?? null)
  return isError(v) && v.code === '#N/A' ? scalarOf(args[1] ?? null) : v
}

/** SI.CONDITIONS(condition1; valeur1; …) : première condition vraie, sinon #N/A. */
const ifs: Impl = (args) => {
  if (args.length % 2 !== 0) return err('#VALUE!', 'Les conditions et les valeurs vont par paires')
  for (let i = 0; i < args.length; i += 2) {
    const cond = toBoolean(scalarOf(args[i] ?? null))
    if (isError(cond)) return cond
    if (cond) return scalarOf(args[i + 1] ?? null)
  }
  return err('#N/A', 'Aucune condition n’est remplie')
}

/** SI.MULTIPLE(expression; valeur1; résultat1; …; [par_défaut]). */
const switchFn: Impl = (args) => {
  const v = scalarOf(args[0] ?? null)
  if (isError(v)) return v
  const rest = args.slice(1)
  const pairs = Math.floor(rest.length / 2)
  for (let i = 0; i < pairs; i++) {
    const candidate = scalarOf(rest[2 * i] ?? null)
    if (isError(candidate)) return candidate
    if (compareValues(v, candidate) === 0) return scalarOf(rest[2 * i + 1] ?? null)
  }
  return rest.length % 2 === 1 ? scalarOf(rest[rest.length - 1] ?? null) : err('#N/A')
}

const xor: Impl = (args) => {
  let trues = 0
  let seen = false
  for (const v of flatten(args)) {
    if (isError(v)) return v
    if (v === null || typeof v === 'string') continue
    const b = toBoolean(v)
    if (isError(b)) return b
    seen = true
    if (b) trues++
  }
  return seen ? trues % 2 === 1 : err('#VALUE!', 'Aucune valeur logique')
}

export const INFO_FUNCTIONS: Record<string, FunctionSpec> = {
  ISBLANK: { minArgs: 1, maxArgs: 1, impl: is((v) => v === null) },
  ISNUMBER: { minArgs: 1, maxArgs: 1, impl: is((v) => typeof v === 'number') },
  ISTEXT: { minArgs: 1, maxArgs: 1, impl: is((v) => typeof v === 'string') },
  ISLOGICAL: { minArgs: 1, maxArgs: 1, impl: is((v) => typeof v === 'boolean') },
  ISERROR: { minArgs: 1, maxArgs: 1, impl: is(isError) },
  ISNA: { minArgs: 1, maxArgs: 1, impl: is((v) => isError(v) && v.code === '#N/A') },
  NA: { minArgs: 0, maxArgs: 0, impl: () => err('#N/A') },
  IFNA: { minArgs: 2, maxArgs: 2, impl: ifna },
  IFS: { minArgs: 2, maxArgs: Infinity, impl: ifs },
  SWITCH: { minArgs: 3, maxArgs: Infinity, impl: switchFn },
  XOR: { minArgs: 1, maxArgs: Infinity, impl: xor },
  TRUE: { minArgs: 0, maxArgs: 0, impl: () => true },
  FALSE: { minArgs: 0, maxArgs: 0, impl: () => false },
}
