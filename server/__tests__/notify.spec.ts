import { describe, expect, it } from 'vitest'
import { escapeHtml, firstName, kyivDate, texts } from '../notify'

describe('сповіщення', () => {
  it('рахує дату за Києвом, а не за UTC сервера', () => {
    // 23:30 UTC 4 листопада — у Києві вже 5-те
    expect(kyivDate(new Date('2026-11-04T23:30:00Z'))).toBe('2026-11-05')
    expect(kyivDate(new Date('2026-11-04T12:00:00Z'))).toBe('2026-11-04')
  })

  it('екранує HTML у тому, що написали люди', () => {
    expect(escapeHtml('<b>Олена & Ко</b>')).toBe('&lt;b&gt;Олена &amp; Ко&lt;/b&gt;')
    expect(texts.comment('lunch', 'Супер <3')).toBe('💬 <b>Анастасія прокоментувала ваш обід</b>\n«Супер &lt;3»')
  })

  it('пише час консультації за Києвом', () => {
    const a = { starts_at: '2026-11-06T12:00:00Z', kind: 'Супровід', zoom_url: null }
    expect(texts.appointment(a, false)).toContain('6 листопада, 14:00 · Супровід')
    expect(texts.appointment(a, true)).toContain('перенесено')
    expect(texts.reminder(a)).toContain('Сьогодні о 14:00')
  })

  it('збирає запис щоденника для нутриціолога', () => {
    expect(
      texts.diaryEntry('Олена Коваль', { meal: 'dinner', note: 'Риба з овочами', hunger: 4, fullness: null, mood: 'Спокійно' }),
    ).toBe('📸 <b>Олена Коваль</b> · вечеря\n«Риба з овочами»\nголод 4/5 · спокійно')
  })

  it('ранковий підсумок', () => {
    const t = texts.digest({
      appointments: [{ starts_at: '2026-11-05T08:30:00Z', client: 'Олена', kind: 'Перша консультація' }],
      unseen: 3,
      silent: [
        { name: 'Ірина', days: 4 },
        { name: 'Марко', days: null },
      ],
    })
    expect(t).toContain('10:30 — Олена · Перша консультація')
    expect(t).toContain('<b>3</b>')
    expect(t).toContain('Ірина — 4 дн.')
    expect(t).toContain('Марко — понад місяць')
    expect(firstName('  Олена Коваль ')).toBe('Олена')
  })
})
