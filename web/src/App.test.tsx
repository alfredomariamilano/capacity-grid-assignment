import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

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

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

function stubFetch() {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.startsWith('/api/capacity')) {
        return new Response(JSON.stringify({ weeks: ['2025-12-29'], people: [] }), {
          status: 200,
        })
      }
      return new Response('not found', { status: 404 })
    }),
  )
  return calls
}

describe('App', () => {
  it('loads the default range once', async () => {
    const calls = stubFetch()
    renderApp()

    await screen.findByText('Person')
    const capacityCalls = calls.filter((u) => u.startsWith('/api/capacity'))
    expect(capacityCalls).toHaveLength(1)
    expect(capacityCalls[0]).toContain('from=2025-12-29&to=2026-01-16')
  })

  it('applies a new range and refetches', async () => {
    const calls = stubFetch()
    renderApp()

    await screen.findByText('Person')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-05' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-02-06' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))

    await waitFor(() =>
      expect(calls.filter((u) => u.startsWith('/api/capacity'))).toHaveLength(2),
    )
    expect(calls.at(-1)).toContain('from=2026-01-05&to=2026-02-06')
  })

  it('rejects an invalid range without fetching', async () => {
    const calls = stubFetch()
    renderApp()

    await screen.findByText('Person')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-02-06' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-01-05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('From must be before to')
    expect(calls.filter((u) => u.startsWith('/api/capacity'))).toHaveLength(1)
  })
})
