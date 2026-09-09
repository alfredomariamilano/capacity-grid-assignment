import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Person } from './CapacityGrid'
import { capacityQueryKey } from './CapacityGrid'

type Props = {
  person: Person
  from: string
  to: string
  anchor: { top: number; left: number }
  onClose: () => void
}

// The editor is a single portal rendered by CapacityGrid (not by each row).
// Rows are virtualized and can be remounted at any time; an editor living
// inside a row would lose its state the moment its row remounts. Portaled to
// document.body and hosted at the grid level, its state is untouchable by the
// virtualizer.
export function WeeklyHoursEditor({ person, from, to, anchor, onClose }: Props) {
  const [value, setValue] = useState(String(person.weeklyHours))
  const [validationError, setValidationError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (hours: number): Promise<Person> => {
      const res = await fetch(`/api/people/${person.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeklyHours: hours }),
      })
      if (!res.ok) throw new Error(`save failed: ${res.status}`)
      return res.json()
    },
    onSuccess: (updated) => {
      // Server-authoritative local patch: allocations don't depend on
      // weeklyHours, so updating the cache keeps every derived number right
      // without refetching the range.
      queryClient.setQueryData(
        capacityQueryKey(from, to),
        (old?: { weeks: string[]; people: Person[] }) =>
          old
            ? {
                ...old,
                people: old.people.map((p) =>
                  p.id === updated.id ? { ...p, weeklyHours: updated.weeklyHours } : p,
                ),
              }
            : old,
      )
      onClose()
    },
  })

  const save = () => {
    if (value.trim() === '') {
      setValidationError('Enter a number between 0 and 168')
      return
    }
    const hours = Number(value)
    if (!Number.isFinite(hours) || hours < 0 || hours > 168) {
      setValidationError('Enter a number between 0 and 168')
      return
    }
    setValidationError(null)
    mutation.mutate(hours)
  }

  const error =
    validationError ?? (mutation.error instanceof Error ? mutation.error.message : null)

  return createPortal(
    <span className="hours-popover" style={{ top: anchor.top, left: anchor.left }}>
      <input
        type="number"
        min={0}
        max={168}
        value={value}
        autoFocus
        disabled={mutation.isPending}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') onClose()
        }}
        aria-label={`Weekly hours for ${person.name}`}
      />
      <button type="button" className="save" onClick={save} disabled={mutation.isPending}>
        Save
      </button>
      <button type="button" className="cancel" onClick={onClose} disabled={mutation.isPending}>
        Cancel
      </button>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </span>,
    document.body,
  )
}
