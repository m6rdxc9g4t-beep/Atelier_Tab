import {
  Calendar,
  CircleDot,
  Euro,
  Hash,
  Percent,
  SquareCheck,
  SquareFunction,
  Type,
  User,
  type LucideIcon,
} from 'lucide-react'
import type { FieldType } from '@/types/domain'

export const FIELD_ICONS: Record<FieldType, LucideIcon> = {
  text: Type,
  number: Hash,
  currency: Euro,
  percent: Percent,
  select: CircleDot,
  date: Calendar,
  checkbox: SquareCheck,
  owner: User,
  formula: SquareFunction,
}

const DEFAULT_WIDTHS: Record<FieldType, number> = {
  text: 200,
  number: 130,
  currency: 150,
  percent: 110,
  select: 150,
  date: 140,
  checkbox: 132,
  owner: 170,
  formula: 150,
}

export function fieldWidth(field: { type: FieldType; width?: number }): number {
  return field.width ?? DEFAULT_WIDTHS[field.type]
}

/** Teintes successives des références de formule (comme les couleurs d'Excel). */
export const REF_HUES = [252, 150, 300, 70, 350, 190] as const

export function refHue(index: number): number {
  return REF_HUES[index % REF_HUES.length] ?? 252
}
