import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapacityGrid } from './CapacityGrid'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        key: index,
        index,
        start: index * 40,
        end: (index + 1) * 40,
        size: 40,
        lane: 0,
      })),
    getTotalSize: () => opts.count * 40,
    measureElement: undefined,
  }),
}))

const fixture = {
  weeks: ['2025-12-29', '2026-01-05'],
  people: [
    { id: 1, name: 'Ana Ferreira', weeklyHours: 40, allocations: { '2025-12-29': 40, '2026-01-05': 0 } },
    { id: 4, name: 'Dee Okafor', weeklyHours: 40, allocations: { '2025-12-29': 0, '2026-01-05': 45 } },
    { id: 5, name: 'Eli Nakamura', weeklyHours: 0, allocations: { '2025-12-29': 0, '2026-01-05': 20 } },
  ],
}

function stubCapacityFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/capacity')) {
        return new Response(JSON.stringify(fixture), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

function renderGrid() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CapacityGrid from="2025-12-29" to="2026-01-05" />
    </QueryClientProvider>,
  )
}

describe('CapacityGrid', () => {
  it('renders a row per person and a column per week', async () => {
    stubCapacityFetch()
    renderGrid()

    expect(await screen.findByText('Ana Ferreira')).toBeTruthy()
    expect(screen.getByText('Dee Okafor')).toBeTruthy()
    expect(screen.getByText('Eli Nakamura')).toBeTruthy()
    expect(screen.getByText('Dec 29')).toBeTruthy()
    expect(screen.getByText('Jan 5')).toBeTruthy()
  })

  it('marks over-allocated cells', async () => {
    stubCapacityFetch()
    renderGrid()

    const deeCell = (await screen.findByText('45 / 40')).closest('td')
    expect(deeCell?.className).toBe('over')
    const eliCell = screen.getByText('20 / 0').closest('td')
    expect(eliCell?.className).toBe('over')
    const anaCell = screen.getByText('40 / 40').closest('td')
    expect(anaCell?.className).not.toBe('over')
  })

  it('updates weekly hours locally after a save, without refetching capacity', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/capacity')) {
        return new Response(JSON.stringify(fixture), { status: 200 })
      }
      if (url === '/api/people/4' && init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({ id: 4, name: 'Dee Okafor', weeklyHours: 32 }),
          { status: 200 },
        )
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderGrid()

    await screen.findByText('45 / 40')
    const deeRow = screen.getByText('Dee Okafor').closest('tr')!
    await user.click(within(deeRow).getByRole('button', { name: '40h/wk' }))
    const input = screen.getByLabelText('Weekly hours for Dee Okafor')
    await user.clear(input)
    await user.type(input, '32')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const cell = (await screen.findByText('45 / 32')).closest('td')
    expect(cell?.className).toBe('over')

    const capacityCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).startsWith('/api/capacity'),
    )
    expect(capacityCalls).toHaveLength(1)
  })

  it('rejects an emptied input with a validation error and no PATCH', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/capacity')) {
        return new Response(JSON.stringify(fixture), { status: 200 })
      }
      if (url === '/api/people/4' && init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({ id: 4, name: 'Dee Okafor', weeklyHours: 32 }),
          { status: 200 },
        )
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderGrid()

    await screen.findByText('45 / 40')
    const deeRow = screen.getByText('Dee Okafor').closest('tr')!
    await user.click(within(deeRow).getByRole('button', { name: '40h/wk' }))
    const input = screen.getByLabelText('Weekly hours for Dee Okafor')
    await user.clear(input)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Enter a number between 0 and 168')
    const patchCalls = fetchMock.mock.calls.filter(
      ([input, init]) => String(input) === '/api/people/4' && init?.method === 'PATCH',
    )
    expect(patchCalls).toHaveLength(0)
  })
})