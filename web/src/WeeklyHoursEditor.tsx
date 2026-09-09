import type { Person } from './CapacityGrid'

type Props = {
  person: Person
  from: string
  to: string
}

// Placeholder — Task 5 turns this into an inline editor with a mutation.
export function WeeklyHoursEditor({ person }: Props) {
  return (
    <button type="button" className="hours">
      {person.weeklyHours}h/wk
    </button>
  )
}