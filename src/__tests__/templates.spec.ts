// У dev-режимі Vite віддає pug-шаблон як чистий JS (без TypeScript-трансформації),
// тож `x!.y` чи `$event.target as T` у шаблоні валять сторінку в браузері,
// хоча збірка й типи проходять. Ловимо це тут.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? vueFiles(join(dir, e.name)) : e.name.endsWith('.vue') ? [join(dir, e.name)] : [],
  )
}

const TS_ONLY = [
  { name: 'non-null `!`', re: /[\w)\]]!(?=[.)\],\s'"])/ },
  { name: '`as Type`', re: /\sas\s+[A-Z]\w*/ },
  { name: '`<Type>` generic call', re: /\w<[A-Z]\w*>\(/ },
]

function problems(file: string): string[] {
  const template = readFileSync(file, 'utf8').match(/<template[^>]*>([\s\S]*)<\/template>/)?.[1] ?? ''
  return template.split('\n').flatMap((line, i) =>
    line.trim().startsWith('//')
      ? []
      : TS_ONLY.filter((r) => r.re.test(line)).map(
          (r) => `${file.slice(SRC.length + 1)} (рядок шаблону ${i + 1}): ${r.name}: ${line.trim()}`,
        ),
  )
}

describe('шаблони', () => {
  it('без TypeScript-синтаксису', () => {
    expect(vueFiles(SRC).flatMap(problems)).toEqual([])
  })
})
