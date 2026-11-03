import { describe, expect, it } from 'vitest'
import { days, greeting, isoDate, longDate, streak, weekday, weekStart } from '../lib/dates'

// 5 листопада 2026 — четвер
const THU = new Date(2026, 10, 5, 9, 30)

describe('dates', () => {
  it('тиждень з понеділка, дні 1–7', () => {
    expect(weekday(THU)).toBe(4)
    expect(weekday(new Date(2026, 10, 8))).toBe(7) // неділя
    expect(isoDate(weekStart(THU))).toBe('2026-11-02')
    expect(isoDate(weekStart(new Date(2026, 10, 8)))).toBe('2026-11-02')
    expect(isoDate(weekStart(new Date(2026, 10, 9)))).toBe('2026-11-09')
  })

  it('пише дату по-українськи з великої літери', () => {
    expect(longDate(THU)).toBe('Четвер, 5 листопада')
  })

  it('вітання за часом доби', () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe('Доброго ранку')
    expect(greeting(new Date(2026, 0, 1, 14))).toBe('Доброго дня')
    expect(greeting(new Date(2026, 0, 1, 21))).toBe('Доброго вечора')
  })

  it('серія днів рахується від сьогодні або від учора', () => {
    expect(streak(['2026-11-05', '2026-11-04', '2026-11-03', '2026-11-01'], THU)).toBe(3)
    expect(streak(['2026-11-04', '2026-11-03'], THU)).toBe(2) // сьогодні ще не записали
    expect(streak(['2026-11-02'], THU)).toBe(0)
    expect(streak([], THU)).toBe(0)
  })

  it('відмінює «день»', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25].map(days)).toEqual([
      '1 день',
      '2 дні',
      '5 днів',
      '11 днів',
      '12 днів',
      '21 день',
      '22 дні',
      '25 днів',
    ])
  })
})
