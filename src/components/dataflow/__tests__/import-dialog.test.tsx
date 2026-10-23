// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImportDialog } from '../ImportDialog'
import { useDataStore, useUIStore } from '@/store'

const CSV = ['Lot / Tâche;Coût HT;Payé', 'Menuiseries;10 000 €;Oui', 'VRD;3 500 €;Non'].join('\n')

function csvFile(content: string, name = 'devis.csv') {
  return new File([content], name, { type: 'text/csv' })
}

beforeEach(() => {
  act(() => {
    useDataStore.getState().reset()
    useUIStore.setState({ activeTableId: 'tbl_planning_lots', importRequest: null })
  })
})
afterEach(cleanup)

describe('assistant d’import CSV', () => {
  it('fichier déposé : correspondance proposée, import dans la table ouverte', async () => {
    act(() =>
      useUIStore.getState().openImport({
        projectId: 'proj_renovation_2026',
        tableId: 'tbl_planning_lots',
        file: csvFile(CSV),
      }),
    )
    render(<ImportDialog />)

    // Colonnes reconnues par leur libellé ; « Payé » devient une nouvelle colonne Case à cocher.
    const dest = await screen.findByLabelText('Destination de la colonne Coût HT')
    expect((dest as HTMLSelectElement).value).toBe('field:cost_ht')
    expect((screen.getByLabelText('Type de la colonne Payé') as HTMLSelectElement).value).toBe(
      'checkbox',
    )

    fireEvent.click(screen.getByRole('button', { name: /Importer 2 lignes/ }))

    const table = useDataStore.getState().tables.tbl_planning_lots!
    expect(table.rowOrder).toHaveLength(6)
    const [r4] = table.rowOrder.slice(3) as [string]
    expect(table.records[r4]?.cells).toMatchObject({ task_name: 'Menuiseries', cost_ht: 10000 })
    expect(Object.values(table.fields).some((f) => f.label === 'Payé')).toBe(true)
    expect(useUIStore.getState().importRequest).toBeNull()
  })

  it('collage depuis Excel → nouvelle table du projet, colonne ignorée', async () => {
    act(() =>
      useUIStore.getState().openImport({ projectId: 'proj_renovation_2026', tableId: null }),
    )
    render(<ImportDialog />)
    fireEvent.click(screen.getByText('Ou coller des cellules copiées depuis Excel'))
    fireEvent.change(screen.getByLabelText('Données à importer'), {
      target: { value: 'Poste\tMontant\tNote\nFondations\t1 200\tx\nToiture\t800\ty' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))

    await waitFor(() => screen.getByLabelText('Nom de la nouvelle table'))
    fireEvent.change(screen.getByLabelText('Nom de la nouvelle table'), {
      target: { value: 'Devis' },
    })
    fireEvent.change(screen.getByLabelText('Destination de la colonne Note'), {
      target: { value: 'skip' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Importer 2 lignes/ }))

    const s = useDataStore.getState()
    const project = s.projects.proj_renovation_2026!
    const created = s.tables[project.tableIds.at(-1)!]!
    expect(created.name).toBe('Devis')
    expect(created.fieldOrder.map((id) => created.fields[id]!.label)).toEqual(['Poste', 'Montant'])
    expect(useUIStore.getState().activeTableId).toBe(created.id)
  })

  it('aucune colonne en commun avec la table ouverte : nouvelle table proposée', async () => {
    act(() =>
      useUIStore.getState().openImport({
        projectId: 'proj_renovation_2026',
        tableId: 'tbl_planning_lots',
        file: csvFile('id.Sujet.Type\n1.Corriger.Bug\n2.Documenter.Task\n3.Tester.Task\n'),
      }),
    )
    render(<ImportDialog />)
    const newTable = await screen.findByRole('radio', { name: /Nouvelle table dans/ })
    expect((newTable as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(/3 colonnes/)).toBeTruthy()
  })

  it('fichier qui n’est pas un CSV : message clair', async () => {
    act(() =>
      useUIStore.getState().openImport({
        projectId: 'proj_renovation_2026',
        tableId: null,
        file: new File(['%PDF'], 'devis.pdf', { type: 'application/pdf' }),
      }),
    )
    render(<ImportDialog />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/n’est pas un fichier CSV/)
  })
})
