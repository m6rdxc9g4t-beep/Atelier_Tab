// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Sidebar } from '../Sidebar'
import { useDataStore, useUIStore } from '@/store'

beforeEach(() => {
  act(() => {
    useDataStore.getState().reset()
    useUIStore.setState({
      activeTableId: 'tbl_planning_lots',
      expandedProjectIds: ['proj_renovation_2026'],
      importRequest: null,
    })
  })
})
afterEach(cleanup)

describe('suppression depuis la sidebar', () => {
  it('table : confirmation, puis une autre table du projet est ouverte', () => {
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la table Planning & Lots' }))
    expect(
      screen.getByRole('dialog', { name: 'Supprimer la table « Planning & Lots » ?' }),
    ).toBeTruthy()
    // Annuler ne supprime rien.
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(useDataStore.getState().tables.tbl_planning_lots).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la table Planning & Lots' }))
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }))
    const s = useDataStore.getState()
    expect(s.tables.tbl_planning_lots).toBeUndefined()
    expect(s.projects.proj_renovation_2026?.tableIds).not.toContain('tbl_planning_lots')
    expect(useUIStore.getState().activeTableId).toBe(s.projects.proj_renovation_2026?.tableIds[0])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('projet : toutes ses tables disparaissent', () => {
    render(<Sidebar />)
    const tableIds = [...useDataStore.getState().projects.proj_renovation_2026!.tableIds]
    fireEvent.click(
      screen.getByRole('button', { name: 'Supprimer le projet Rénovation Urbaine 2026' }),
    )
    expect(screen.getByText(/Ses 3 tables/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }))
    const s = useDataStore.getState()
    expect(s.projects.proj_renovation_2026).toBeUndefined()
    for (const id of tableIds) expect(s.tables[id]).toBeUndefined()
    const active = useUIStore.getState().activeTableId
    expect(active && s.tables[active]).toBeTruthy()
    expect(screen.queryByText('Rénovation Urbaine 2026')).toBeNull()
  })
})
