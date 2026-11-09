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

const typeAndEnter = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('espaces de travail depuis la sidebar', () => {
  it('crée un espace, puis un premier projet dedans', () => {
    render(<Sidebar />)
    const before = useDataStore.getState().workspaceOrder.length

    fireEvent.click(screen.getByRole('button', { name: 'Nouvel espace' }))
    typeAndEnter(screen.getByPlaceholderText('Nom de l’espace'), '  Espace Client  ')

    const s = useDataStore.getState()
    expect(s.workspaceOrder).toHaveLength(before + 1)
    const wsId = s.workspaceOrder.at(-1)!
    expect(s.workspaces[wsId]?.name).toBe('Espace Client')
    expect(screen.getByRole('heading', { name: 'Espace Client' })).toBeTruthy()

    // Espace vide : un bouton « Nouveau projet » invite à le remplir.
    fireEvent.click(screen.getByRole('button', { name: 'Nouveau projet' }))
    typeAndEnter(screen.getByPlaceholderText('Nom du projet'), 'Devis 2027')
    const after = useDataStore.getState()
    const projectId = after.workspaces[wsId]!.projectIds[0]!
    expect(after.projects[projectId]?.name).toBe('Devis 2027')
    expect(useUIStore.getState().activeTableId).toBe(after.projects[projectId]?.tableIds[0])
  })

  it('un nom vide ou Échap ne crée rien', () => {
    render(<Sidebar />)
    const before = useDataStore.getState().workspaceOrder.length
    fireEvent.click(screen.getByRole('button', { name: 'Nouvel espace' }))
    typeAndEnter(screen.getByPlaceholderText('Nom de l’espace'), '   ')
    fireEvent.click(screen.getByRole('button', { name: 'Nouvel espace' }))
    fireEvent.keyDown(screen.getByPlaceholderText('Nom de l’espace'), { key: 'Escape' })
    expect(useDataStore.getState().workspaceOrder).toHaveLength(before)
  })

  it('renomme un espace par double-clic', () => {
    render(<Sidebar />)
    const wsId = useDataStore.getState().workspaceOrder[0]!
    const name = useDataStore.getState().workspaces[wsId]!.name
    fireEvent.doubleClick(screen.getByRole('heading', { name }))
    typeAndEnter(screen.getByRole('textbox', { name: 'Nom de l’espace' }), 'Archi & Co')
    expect(useDataStore.getState().workspaces[wsId]?.name).toBe('Archi & Co')
  })

  it('supprime un espace, ses projets et ses tables, et ouvre une table restante', () => {
    render(<Sidebar />)
    const s0 = useDataStore.getState()
    const wsId = s0.projects.proj_renovation_2026!.workspaceId
    const ws = s0.workspaces[wsId]!
    const tableIds = ws.projectIds.flatMap((id) => s0.projects[id]?.tableIds ?? [])

    fireEvent.click(screen.getByRole('button', { name: `Supprimer l’espace ${ws.name}` }))
    expect(screen.getByRole('dialog', { name: `Supprimer l’espace « ${ws.name} » ?` })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }))

    const s = useDataStore.getState()
    expect(s.workspaces[wsId]).toBeUndefined()
    expect(s.workspaceOrder).not.toContain(wsId)
    for (const id of ws.projectIds) expect(s.projects[id]).toBeUndefined()
    for (const id of tableIds) expect(s.tables[id]).toBeUndefined()
    const active = useUIStore.getState().activeTableId
    expect(active === null || Boolean(s.tables[active])).toBe(true)
  })
})
