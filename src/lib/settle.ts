// Відмічений пункт не стрибає одразу: спершу людина бачить закреслення, і лише потім
// він плавно їде вниз чи зникає зі списку. `parked` — пункти, які вже «відїхали».
import { onBeforeUnmount, ref } from 'vue'

export const SETTLE_MS = 700

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function useSettle(delay = SETTLE_MS) {
  const parked = ref(new Set<string>())
  /** щойно відмічені — ще на місці, грає анімація галочки */
  const fresh = ref(new Set<string>())
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const without = (set: Set<string>, id: string) => {
    const next = new Set(set)
    next.delete(id)
    return next
  }

  function cancel(id: string) {
    const t = timers.get(id)
    if (t) clearTimeout(t)
    timers.delete(id)
    fresh.value = without(fresh.value, id)
  }

  /** після завантаження: куплене одразу на своєму місці, без анімації */
  function reset(ids: Iterable<string>) {
    for (const id of timers.keys()) cancel(id)
    parked.value = new Set(ids)
  }

  function update(id: string, checked: boolean) {
    cancel(id)
    if (!checked) {
      parked.value = without(parked.value, id)
      return
    }
    const wait = reducedMotion() ? 0 : delay
    fresh.value = new Set(fresh.value).add(id)
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        fresh.value = without(fresh.value, id)
        parked.value = new Set(parked.value).add(id)
      }, wait),
    )
  }

  onBeforeUnmount(() => timers.forEach(clearTimeout))
  return { parked, fresh, reset, update }
}
