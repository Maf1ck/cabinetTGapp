// Заливає базу рецептів із таблиці: pnpm recipes:import ../recipes_db.xlsx
// Ідемпотентно: ті самі id у таблиці → ті самі рядки в базі; склад страви переписується повністю.
// Рецепти, яких немає в таблиці, не видаляються (їх могли додати вручну в кабінеті).
import { readSheet } from 'read-excel-file/node'
import { db } from '../server/accounts.js'
import { buildCatalog, SHEETS, type Sheet } from '../server/recipe-sheet.js'

const file = process.argv[2]
if (!file) {
  console.error('Вкажіть файл: pnpm recipes:import <шлях до recipes_db.xlsx>')
  process.exit(1)
}

const sheets: Record<string, Sheet> = {}
for (const name of Object.values(SHEETS)) sheets[name] = await readSheet(file, name)
const catalog = buildCatalog(sheets)

const sb = db()
const fail = (step: string, error: unknown) => {
  const e = error as { code?: string; message?: string; hint?: string }
  console.error(`✗ ${step}: ${[e.code, e.message, e.hint].filter(Boolean).join(' · ')}`)
  if (e.code === 'PGRST204' || e.code === '42P01' || e.code === 'PGRST205')
    console.error('  Схоже, не застосовано міграцію supabase/migrations/0004_recipe_catalog.sql')
  process.exit(1)
}

const chunks = <T>(rows: T[], size = 200) =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size))

{
  const { error } = await sb.from('ingredients').upsert(catalog.ingredients, { onConflict: 'id' })
  if (error) fail('інгредієнти', error)
}
{
  const { error } = await sb.from('recipes').upsert(catalog.recipes, { onConflict: 'id' })
  if (error) fail('рецепти', error)
}
{
  const ids = catalog.recipes.map((r) => r.id)
  const { error } = await sb.from('recipe_ingredients').delete().in('recipe_id', ids)
  if (error) fail('очищення складу', error)
  for (const part of chunks(catalog.lines)) {
    const { error: insertError } = await sb.from('recipe_ingredients').insert(part)
    if (insertError) fail('склад рецептів', insertError)
  }
}

console.log(
  `✓ Інгредієнтів: ${catalog.ingredients.length}, рецептів: ${catalog.recipes.length}, рядків складу: ${catalog.lines.length}`,
)
if (catalog.toReview.length) {
  console.log(`\nВарто перевірити (${catalog.toReview.length}):`)
  for (const r of catalog.toReview) console.log(`  • ${r.title}: ${r.text}`)
}
