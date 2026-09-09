import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { tableFeatures, useTable, FlexRender, columnSizingFeature, columnVisibilityFeature } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { WeeklyHoursEditor } from './WeeklyHoursEditor'

type Props = {
  from: string
  to: string
}

export type Person = {
  id: number
  name: string
  weeklyHours: number
  allocations: Record<string, number>
}

export type CapacityResponse = {
  weeks: string[]
  people: Person[]
}

export const capacityQueryKey = (from: string, to: string) => ['capacity', from, to] as const

async function fetchCapacity(from: string, to: string): Promise<CapacityResponse> {
  const res = await fetch(`/api/capacity?from=${from}&to=${to}`)
  if (!res.ok) throw new Error(`GET /api/capacity failed: ${res.status}`)
  return res.json()
}

export function formatHours(h: number): string {
  return Number.isInteger(h) ? String(h) : h.toFixed(1)
}

export function formatWeek(iso: string): string {
  // Parse as UTC so local timezones don't shift the displayed day.
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const features = tableFeatures({ columnSizingFeature, columnVisibilityFeature })

export function CapacityGrid({ from, to }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [editTarget, setEditTarget] = useState<{
    person: Person
    top: number
    left: number
  } | null>(null)

  const { data, isPending, isError, error } = useQuery({
    queryKey: capacityQueryKey(from, to),
    queryFn: () => fetchCapacity(from, to),
  })

  const people = data?.people ?? []
  const weeks = data?.weeks ?? []

  const columns: ColumnDef<typeof features, Person>[] = [
    {
      accessorKey: 'name',
      header: 'Person',
      size: 220,
      cell: (info) => {
        const person = info.row.original
        return (
          <span>
            {info.getValue<string>()}{' '}
            <button
              type="button"
              className="hours"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setEditTarget({ person, top: rect.bottom + 4, left: rect.left })
              }}
            >
              {person.weeklyHours}h/wk
            </button>
          </span>
        )
      },
    },
    ...weeks.map(
      (week): ColumnDef<typeof features, Person> => ({
        id: week,
        header: formatWeek(week),
        size: 120,
        accessorFn: (p: Person) => p.allocations[week] ?? 0,
        cell: (info) => {
          const allocated = info.getValue<number>()
          const person = info.row.original
          return (
            <span>
              {formatHours(allocated)} / {formatHours(person.weeklyHours)}
            </span>
          )
        },
      }),
    ),
  ]

  const table = useTable({
    key: 'capacity-grid',
    features,
    columns,
    data: people,
  })

  const rows = table.getRowModel().rows

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 33,
    overscan: 5,
    useFlushSync: false,
  })

  if (isPending) return <p>Loading capacity…</p>
  if (isError) return <p role="alert">Could not load capacity: {error?.message}</p>

  return (
    <>
      <div ref={containerRef} className="grid-scroll">
        <table className="grid">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} style={{ width: header.getSize() }}>
                  {header.isPlaceholder ? null : <FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            return (
              <tr
                key={row.original.id}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {row.getVisibleCells().map((cell) => {
                  const person = cell.row.original
                  const week = cell.column.id
                  const allocated = person.allocations[week] ?? 0
                  const over = allocated > person.weeklyHours
                  return (
                    <td key={cell.id} className={over ? 'over' : undefined} style={{ width: cell.column.getSize() }}>
                      <FlexRender cell={cell} />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
        </table>
      </div>
      {editTarget && (
        <WeeklyHoursEditor
          person={editTarget.person}
          from={from}
          to={to}
          anchor={{ top: editTarget.top, left: editTarget.left }}
          onClose={() => setEditTarget(null)}
        />
      )}
    </>
  )
}