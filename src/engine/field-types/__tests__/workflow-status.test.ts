import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUS_CHOICES } from '@/store/factories'
import { parseUserInput } from '..'
import {
  atelierStatusChoices,
  mergeAtelierStatuses,
  WORKFLOW_STATUSES,
  workflowStatusCode,
} from '../workflow-status'

describe('statuts de workflow (SUITE.md §1.4)', () => {
  it('reconnaît les 8 libellés officiels et leurs codes', () => {
    expect(WORKFLOW_STATUSES.map((s) => [s.code, s.label, s.cssVar])).toEqual([
      ['OPEN', 'À faire', '--status-open'],
      ['IN_PROGRESS', 'En cours', '--status-progress'],
      ['IN_REVIEW', 'En revue', '--status-review'],
      ['ON_HOLD', 'En attente', '--status-hold'],
      ['BLOCKED', 'Bloquée', '--status-blocked'],
      ['RESOLVED', 'Résolue', '--status-resolved'],
      ['CLOSED', 'Terminée', '--status-closed'],
      ['REJECTED', 'Rejetée', '--status-rejected'],
    ])
    for (const s of WORKFLOW_STATUSES) {
      expect(workflowStatusCode(s.label)).toBe(s.code)
      expect(workflowStatusCode(s.code)).toBe(s.code)
    }
  })

  it('ignore la casse, les accents et les séparateurs', () => {
    expect(workflowStatusCode('a FAIRE')).toBe('OPEN')
    expect(workflowStatusCode('  en Cours ')).toBe('IN_PROGRESS')
    expect(workflowStatusCode('in progress')).toBe('IN_PROGRESS')
    expect(workflowStatusCode('on-hold')).toBe('ON_HOLD')
    expect(workflowStatusCode('BLOQUEE')).toBe('BLOCKED')
    expect(workflowStatusCode('resolue')).toBe('RESOLVED')
  })

  it('accepte les synonymes du contrat', () => {
    expect(workflowStatusCode('Ouvert')).toBe('OPEN')
    expect(workflowStatusCode('Nouveau')).toBe('OPEN')
    expect(workflowStatusCode('Fait')).toBe('CLOSED')
    expect(workflowStatusCode('Terminé')).toBe('CLOSED')
    expect(workflowStatusCode('Clos')).toBe('CLOSED')
    expect(workflowStatusCode('Bloqué')).toBe('BLOCKED')
    expect(workflowStatusCode('Résolu')).toBe('RESOLVED')
    expect(workflowStatusCode('Rejeté')).toBe('REJECTED')
    expect(workflowStatusCode('Annulé')).toBe('REJECTED')
  })

  it('ne reconnaît pas un libellé libre', () => {
    for (const label of ['Validé', 'Réceptionné', 'Livré', '', 'En']) {
      expect(workflowStatusCode(label)).toBeNull()
    }
  })

  it('les statuts par défaut d’une nouvelle table sont tous officiels', () => {
    expect(DEFAULT_STATUS_CHOICES.map((c) => workflowStatusCode(c.label))).toEqual([
      'OPEN',
      'IN_PROGRESS',
      'CLOSED',
      'BLOCKED',
    ])
  })
})

describe('préréglage « Statuts Atelier »', () => {
  it('donne les 8 statuts dans l’ordre, avec des ids stables', () => {
    const choices = atelierStatusChoices()
    expect(choices.map((c) => c.label)).toEqual(WORKFLOW_STATUSES.map((s) => s.label))
    expect(choices[0]).toEqual({ id: 'opt_open', label: 'À faire', color: 'gray' })
    expect(new Set(choices.map((c) => c.id)).size).toBe(8)
  })

  it('appliqué à des choix existants, garde leurs ids et les choix non reconnus', () => {
    const merged = mergeAtelierStatuses([
      { id: 'opt_todo', label: 'À faire', color: 'gray' },
      { id: 'opt_ok', label: 'Validé', color: 'green' },
      { id: 'opt_stop', label: 'Bloqué', color: 'pink' },
    ])
    expect(merged.map((c) => c.label)).toEqual([...WORKFLOW_STATUSES.map((s) => s.label), 'Validé'])
    expect(merged.find((c) => c.label === 'À faire')?.id).toBe('opt_todo')
    // « Bloqué » est reconnu : même id, libellé et teinte officiels.
    expect(merged.find((c) => c.id === 'opt_stop')).toEqual({
      id: 'opt_stop',
      label: 'Bloquée',
      color: 'red',
    })
    expect(merged.at(-1)).toEqual({ id: 'opt_ok', label: 'Validé', color: 'green' })
  })

  it('évite une collision d’id avec un choix non reconnu', () => {
    const merged = mergeAtelierStatuses([{ id: 'opt_open', label: 'Ouverture', color: 'teal' }])
    const ids = merged.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(merged.find((c) => c.label === 'À faire')?.id).toBe('opt_open_2')
  })

  it('la saisie accepte un synonyme pour un choix officiel', () => {
    const field = {
      id: 'st',
      label: 'Statut',
      type: 'select' as const,
      options: { choices: atelierStatusChoices() },
    }
    const ctx = { collaborators: {} }
    expect(parseUserInput(field, 'Terminé', ctx)).toEqual({ ok: true, input: 'opt_closed' })
    expect(parseUserInput(field, 'in_review', ctx)).toEqual({ ok: true, input: 'opt_in_review' })
    expect(parseUserInput(field, 'Livré', ctx).ok).toBe(false)
  })
})
