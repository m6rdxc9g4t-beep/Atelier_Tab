/** API publique du moteur de formules. */
export { Workbook, isFormula, type CellInput } from './workbook'
export {
  parseFormula,
  collectReferences,
  formulaReferences,
  type Node,
  type ReferencedArea,
} from './parser'
export { FormulaSyntaxError } from './tokenizer'
export { tokenizeForDisplay, type FormulaSegment } from './display'
export {
  columnToLetters,
  lettersToColumn,
  parseA1,
  toA1,
  refToString,
  translateFormula,
  shiftReferences,
  moveReferences,
  type CellRef,
  type MoveChange,
  type RangeRef,
  type StructuralChange,
} from './references'
export { listFunctionNames } from './functions'
export {
  FormulaError,
  isError,
  serializeValue,
  sameValue,
  type CellValue,
  type ErrorCode,
  type Scalar,
} from './values'
export {
  compareValues,
  dateTextToSerial,
  formatNumberAsText,
  serialToIso,
} from './coerce'
export {
  CATEGORY_LABELS,
  FUNCTION_CATALOG,
  functionDoc,
  suggestFunctions,
  type FunctionCategory,
  type FunctionDoc,
  type FunctionSuggestion,
} from './catalog'
