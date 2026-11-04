// Додає рецепти з таблиці в базу:
//   pnpm recipes:import ../нова.xlsx            — лише показати, що буде (нічого не пише)
//   pnpm recipes:import ../нова.xlsx --apply    — додати нові рецепти й продукти
//   pnpm recipes:import ../нова.xlsx --apply --update — ще й переписати ті, що вже є в базі
//
// Рецепти й продукти звіряються з базою за назвою та синонімами, а не за id з файла:
// кожна таблиця нумерує рядки з 1, тож id різних файлів збігаються.
// З бази нічого не видаляється; рецепт, що вже є, без --update лишається як був
// (його могли поправити в кабінеті).
import { readSheet } from 'read-excel-file/node'
import { db } from '../server/accounts.js'
import { buildCatalog, planMerge, SHEETS, type Sheet } from '../server/recipe-sheet.js'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const apply = args.includes('--apply')
const update = args.includes('--update')
if (!file) {
  console.error('Вкажіть файл: pnpm recipes:import <шлях до .xlsx> [--apply] [--update]')
  process.exit(1)
}

const fail = (step: string, error: unknown): never => {
  const e = error as { code?: string; message?: string; hint?: string }
  console.error(`✗ ${step}: ${[e.code, e.message, e.hint].filter(Boolean).join(' · ')}`)
  if (e.code === 'PGRST204' || e.code === '42P01' || e.code === 'PGRST205')
    console.error('  Схоже, не застосовано міграцію supabase/migrations/0004_recipe_catalog.sql')
  process.exit(1)
}

const sheets: Record<string, Sheet> = {}
for (const name of Object.values(SHEETS)) {
  try {
    sheets[name] = await readSheet(file, name)
  } catch {
    fail('читання файла', { message: `немає аркуша «${name}» (потрібні: ${Object.values(SHEETS).join(', ')})` })
  }
}
const catalog = buildCatalog(sheets)

const sb = db()
const [ing, rec] = await Promise.all([
  sb.from('ingredients').select('id, name, aliases'),
  sb.from('recipes').select('id, title, aliases'),
])
if (ing.error) fail('читання продуктів', ing.error)
if (rec.error) fail('читання рецептів', rec.error)
const plan = planMerge(catalog, { ingredients: ing.data ?? [], recipes: rec.data ?? [] })

const fresh = plan.recipes.filter((r) => r.status === 'new')
const known = plan.recipes.filter((r) => r.status === 'existing')
const toWrite = update ? plan.recipes : fresh

console.log(`Файл: ${catalog.recipes.length} рецептів, ${catalog.ingredients.length} продуктів`)
console.log(`  нових рецептів: ${fresh.length}`)
for (const r of fresh) console.log(`    + ${r.row.title}`)
console.log(`  уже є в базі: ${known.length}${known.length ? (update ? ' — буде переписано' : ' — пропускаю') : ''}`)
for (const r of known)
  console.log(`    = ${r.row.title}${r.existingTitle !== r.row.title ? ` (у базі: «${r.existingTitle}»)` : ''}`)
if (plan.duplicatesInFile.length)
  console.log(`  повтори всередині файла (взято перший): ${plan.duplicatesInFile.join(', ')}`)
console.log(`  продуктів: знайдено в базі ${plan.matchedIngredients}, нових ${plan.newIngredients.length}`)
for (const i of plan.newIngredients) console.log(`    + ${i.name}${i.category ? ` · ${i.category}` : ''}`)
if (plan.ingredientAliases.length)
  console.log(`  нові синоніми для ${plan.ingredientAliases.length} продуктів (${plan.ingredientAliases.map((i) => i.name).join(', ')})`)

if (!apply) {
  console.log('\nЦе лише перегляд, у базу нічого не записано. Щоб додати — повторіть із --apply')
  process.exit(0)
}

const chunks = <T>(rows: T[], size = 200) =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size))

// Продукти потрібні складу, тож спершу вони. Продукти зі складу пропущених рецептів теж додаються —
// вони нікому не заважають і знадобляться в конструкторі.
if (plan.newIngredients.length) {
  const { error } = await sb.from('ingredients').upsert(plan.newIngredients, { onConflict: 'id' })
  if (error) fail('нові продукти', error)
}
for (const a of plan.ingredientAliases) {
  const { error } = await sb.from('ingredients').update({ aliases: a.aliases }).eq('id', a.id)
  if (error) fail(`синоніми «${a.name}»`, error)
}

if (toWrite.length) {
  const { error } = await sb.from('recipes').upsert(toWrite.map((r) => r.row), { onConflict: 'id' })
  if (error) fail('рецепти', error)

  const ids = new Set(toWrite.map((r) => r.row.id))
  const lines = plan.lines.filter((l) => ids.has(l.recipe_id))
  const { error: delError } = await sb.from('recipe_ingredients').delete().in('recipe_id', [...ids])
  if (delError) fail('очищення складу', delError)
  for (const part of chunks(lines)) {
    const { error: insertError } = await sb.from('recipe_ingredients').insert(part)
    if (insertError) fail('склад рецептів', insertError)
  }
}

console.log(`\n✓ Записано: рецептів ${toWrite.length}, нових продуктів ${plan.newIngredients.length}`)
const reviewed = new Set(toWrite.map((r) => r.row.title))
const review = catalog.toReview.filter((r) => reviewed.has(r.title))
if (review.length) {
  console.log(`\nВарто перевірити (${review.length}):`)
  for (const r of review) console.log(`  • ${r.title}: ${r.text}`)
}
