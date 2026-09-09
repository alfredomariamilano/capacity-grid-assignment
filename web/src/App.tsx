import { useState } from 'react'
import { CapacityGrid } from './CapacityGrid'

// Default range the grid loads. Change it from the pickers below.
const DEFAULT_FROM = '2025-12-29'
const DEFAULT_TO = '2026-01-16'
const MAX_RANGE_DAYS = 366

export function App() {
  const [draftFrom, setDraftFrom] = useState(DEFAULT_FROM)
  const [draftTo, setDraftTo] = useState(DEFAULT_TO)
  const [from, setFrom] = useState(DEFAULT_FROM)
  const [to, setTo] = useState(DEFAULT_TO)
  const [error, setError] = useState<string | null>(null)

  const apply = () => {
    // <input type="date"> yields YYYY-MM-DD; ISO strings compare correctly.
    if (!draftFrom || !draftTo) {
      setError('Pick both dates')
      return
    }
    if (draftFrom > draftTo) {
      setError('From must be before to')
      return
    }
    const days = (new Date(draftTo).getTime() - new Date(draftFrom).getTime()) / 86_400_000
    if (days > MAX_RANGE_DAYS) {
      setError('Range too large (max 366 days)')
      return
    }
    setError(null)
    setFrom(draftFrom)
    setTo(draftTo)
  }

  return (
    <main>
      <h1>Team capacity</h1>
      <form
        className="range-form"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        <label>
          From{' '}
          <input
            type="date"
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
          />
        </label>
        <label>
          To{' '}
          <input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} />
        </label>
        <button type="submit" className="apply">
          Show
        </button>
        {error && (
          <span role="alert" className="range-error">
            {error}
          </span>
        )}
      </form>
      <p className="range">
        {from} to {to}
      </p>
      <CapacityGrid from={from} to={to} />
    </main>
  )
}
