import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDepartments, getSubDepartments, getTeams } from '../../api/client'

interface OrgTeamSelectorProps {
  value: number | null
  onChange: (teamId: number | null) => void
  placeholder?: string
}

const SELECT_CLASS = 'border rounded px-3 py-1.5 text-sm bg-white'

/**
 * Cascading Department → Sub-Department → Team selector.
 * Only the final team id is reported to the parent via `value`/`onChange`.
 */
export default function OrgTeamSelector({ value, onChange, placeholder = 'Select team…' }: OrgTeamSelectorProps) {
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const { data: subDepartments = [] } = useQuery({ queryKey: ['subdepartments'], queryFn: () => getSubDepartments() })
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })

  const [deptId, setDeptId] = useState<number | null>(null)
  const [subDeptId, setSubDeptId] = useState<number | null>(null)

  // Pick an initial department/sub-department once reference data has loaded.
  useEffect(() => {
    if (deptId !== null || departments.length === 0 || subDepartments.length === 0) return

    const selectedTeam = value != null ? teams.find(t => t.id === value) : undefined
    if (selectedTeam) {
      const sub = subDepartments.find(sd => sd.id === selectedTeam.sub_department_id)
      setDeptId(sub?.department_id ?? departments[0].id)
      setSubDeptId(selectedTeam.sub_department_id)
      return
    }

    const ramp = departments.find(d => d.code === 'RAMP') ?? departments[0]
    const nb = subDepartments.find(sd => sd.department_id === ramp.id && sd.code === 'NB')
      ?? subDepartments.find(sd => sd.department_id === ramp.id)
    setDeptId(ramp.id)
    setSubDeptId(nb?.id ?? null)
  }, [departments, subDepartments, teams, value, deptId])

  const subDeptOptions = subDepartments.filter(sd => sd.department_id === deptId)
  const teamOptions = teams.filter(t => t.sub_department_id === subDeptId)

  const handleDeptChange = (id: number) => {
    setDeptId(id)
    const firstSub = subDepartments.find(sd => sd.department_id === id)
    setSubDeptId(firstSub?.id ?? null)
    onChange(null)
  }

  const handleSubDeptChange = (id: number) => {
    setSubDeptId(id)
    onChange(null)
  }

  return (
    <>
      <select className={SELECT_CLASS} value={deptId ?? ''} onChange={e => handleDeptChange(Number(e.target.value))}>
        {departments.map(d => <option key={d.id} value={d.id}>{d.code}</option>)}
      </select>
      <select className={SELECT_CLASS} value={subDeptId ?? ''} onChange={e => handleSubDeptChange(Number(e.target.value))}>
        {subDeptOptions.map(sd => <option key={sd.id} value={sd.id}>{sd.name}</option>)}
      </select>
      <select
        className={SELECT_CLASS}
        value={value ?? ''}
        onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
        disabled={teamOptions.length === 0}
      >
        <option value="">{teamOptions.length === 0 ? 'No teams configured yet' : placeholder}</option>
        {teamOptions.map(t => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
      </select>
    </>
  )
}
