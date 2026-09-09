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
  // Absent → edits the person's weekly capacity (PATCH /api/people/{id}).
  // Present → edits that week's allocated hours (PATCH /api/people/{id}/allocations/{week}).
  week?: string
}

// The editor is a single portal rendered by CapacityGrid (not by each row).
// Rows are virtualized and can be remounted at any time; an editor living
// inside a row would lose its state the moment its row remounts. Portaled to
// document.body and hosted at the grid level, its state is untouchable by the
// virtualizer. Reused for both weekly capacity and per-week allocated hours.
export function WeeklyHoursEditor({ person, from, to, anchor, onClose, week }: Props) {
  const [value, setValue] = useState(() =>
    String(week ? (person.allocations[week] ?? 0) : person.weeklyHours),
  )
  const [validationError, setValidationError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (hours: number): Promise<{ id: number; week?: string; hours: number }> => {
      const res = await fetch(
        week ? `/api/people/${person.id}/allocations/${week}` : `/api/people/${person.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(week ? { hours } : { weeklyHours: hours }),
        },
      )
      if (!res.ok) throw new Error(`save failed: ${res.status}`)
      if (week) {
        const saved = (await res.json()) as { id: number; week: string; hours: number }
        return { id: saved.id, week: saved.week, hours: saved.hours }
      }
      const saved = (await res.json()) as { id: number; weeklyHours: number }
      return { id: saved.id, hours: saved.weeklyHours }
    },
    onSuccess: (saved) => {
      // Server-authoritative local patch: allocated hours and capacity don't
      // affect each other's computation, so updating the cache keeps every
      // derived number right without refetching the range.
      queryClient.setQueryData(
        capacityQueryKey(from, to),
        (old?: { weeks: string[]; people: Person[] }) =>
          old
            ? {
                ...old,
                people: old.people.map((p) => {
                  if (p.id !== saved.id) return p
                  if (saved.week) {
                    return { ...p, allocations: { ...p.allocations, [saved.week]: saved.hours } }
                  }
                  return { ...p, weeklyHours: saved.hours }
                }),
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
        aria-label={
          week ? `Allocated hours for ${person.name}` : `Weekly hours for ${person.name}`
        }
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
