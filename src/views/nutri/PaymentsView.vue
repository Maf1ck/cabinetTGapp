<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import {
  deletePayment,
  listClients,
  listPayments,
  savePayment,
  setPaymentStatus,
  type ClientRow,
  type PaymentRow,
  type PaymentStatus,
} from '@/api/nutri'
import { isoDate } from '@/lib/dates'
import { shortName } from '@/lib/clients'

const PRESETS = ['Супровід, місяць', 'Консультація', 'Програма харчування', 'Повторна консультація']
const STATUS: Record<PaymentStatus, string> = { pending: 'Очікує', paid: 'Оплачено', cancelled: 'Скасовано' }

const now = new Date()
const month = ref(new Date(now.getFullYear(), now.getMonth(), 1))
const monthLabel = computed(() => new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' }).format(month.value))
const isThisMonth = computed(() => month.value.getFullYear() === now.getFullYear() && month.value.getMonth() === now.getMonth())
const shiftMonth = (d: number) => (month.value = new Date(month.value.getFullYear(), month.value.getMonth() + d, 1))

const loading = ref(true)
const loadError = ref(false)
const saveError = ref(false)
const busy = ref(false)
const payments = ref<PaymentRow[]>([])
const clients = ref<ClientRow[]>([])
const clientFilter = ref('')

const inMonth = (iso: string | null) => {
  if (!iso) return false
  const d = new Date(iso)
  return d.getFullYear() === month.value.getFullYear() && d.getMonth() === month.value.getMonth()
}
/** У місяці: оплачені в ньому, створені в ньому, і всі неоплачені (борг не зникає з виду) */
const shown = computed(() =>
  payments.value.filter(
    (p) =>
      (!clientFilter.value || p.client?.id === clientFilter.value) &&
      (p.status === 'paid' ? inMonth(p.paid_at) : p.status === 'pending' || inMonth(p.created_at)),
  ),
)
const received = computed(() => shown.value.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount_uah, 0))
const pending = computed(() => shown.value.filter((p) => p.status === 'pending'))
const pendingSum = computed(() => pending.value.reduce((s, p) => s + p.amount_uah, 0))
const uah = (n: number) => `${n.toLocaleString('uk-UA')} ₴`
const dateOf = (iso: string) => new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' }).format(new Date(iso))

// ---- форма
interface Form {
  id?: string
  client_id: string
  title: string
  amount: number | null
  status: PaymentStatus
  paid_on: string
  pay_url: string
}
const form = ref<Form | null>(null)

function openForm(p?: PaymentRow) {
  saveError.value = false
  form.value = p
    ? {
        id: p.id,
        client_id: p.client?.id ?? '',
        title: p.title,
        amount: p.amount_uah,
        status: p.status,
        paid_on: p.paid_at ? isoDate(new Date(p.paid_at)) : isoDate(now),
        pay_url: p.pay_url ?? '',
      }
    : {
        client_id: clientFilter.value,
        title: PRESETS[0]!,
        amount: null,
        status: 'paid',
        paid_on: isoDate(now),
        pay_url: '',
      }
}

const formValid = computed(
  () =>
    !!form.value?.client_id &&
    !!form.value.title.trim() &&
    (form.value.amount ?? 0) > 0 &&
    (!form.value.pay_url.trim() || form.value.pay_url.trim().startsWith('https://')),
)

async function submit() {
  const f = form.value
  if (!f || !formValid.value) return
  busy.value = true
  saveError.value = false
  try {
    const saved = await savePayment(
      {
        client_id: f.client_id,
        title: f.title.trim(),
        amount_uah: Math.round(f.amount ?? 0),
        status: f.status,
        pay_url: f.pay_url.trim() || null,
        paid_at: f.status === 'paid' ? new Date(`${f.paid_on}T12:00:00`).toISOString() : null,
      },
      f.id,
    )
    payments.value = f.id ? payments.value.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...payments.value]
    form.value = null
  } catch {
    saveError.value = true
  } finally {
    busy.value = false
  }
}

async function mark(p: PaymentRow, status: PaymentStatus) {
  saveError.value = false
  try {
    await setPaymentStatus(p.id, status)
    p.status = status
    p.paid_at = status === 'paid' ? new Date().toISOString() : null
  } catch {
    saveError.value = true
  }
}

async function remove(p: PaymentRow) {
  if (!confirm(`Видалити оплату «${p.title}» на ${uah(p.amount_uah)}?`)) return
  try {
    await deletePayment(p.id)
    payments.value = payments.value.filter((x) => x.id !== p.id)
  } catch {
    saveError.value = true
  }
}

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const [p, c] = await Promise.all([listPayments(new Date(now.getFullYear() - 1, now.getMonth(), 1)), listClients()])
    payments.value = p
    clients.value = c
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template lang="pug">
main.page.payments
  .page-head
    div
      .page-head__sub Облік оплат клієнтів
      h1.page-head__title Оплати
    .page-head__actions
      .payments__month
        button.btn.btn--ghost.btn--sm(type='button' aria-label='Попередній місяць' @click='shiftMonth(-1)')
          AppIcon(name='chevronLeft' :size='18')
        span {{ monthLabel }}
        button.btn.btn--ghost.btn--sm(type='button' aria-label='Наступний місяць' :disabled='isThisMonth' @click='shiftMonth(1)')
          AppIcon(name='chevronRight' :size='18')
      button.btn.btn--primary(type='button' @click='openForm()') + Нова оплата

  p.notice(v-if='saveError' role='alert') Не вдалося зберегти. Спробуйте ще раз.

  p.empty(v-if='loading') Завантажуємо…
  p.empty(v-else-if='loadError')
    | Не вдалося завантажити оплати.
    |
    button.btn.btn--soft.btn--sm(type='button' @click='load') Спробувати ще раз

  template(v-else)
    .payments__stats
      .card.payments__stat
        span Отримано за {{ monthLabel }}
        b {{ uah(received) }}
      .card.payments__stat
        span Очікує оплати
        b(:class='{ "is-warn": pendingSum }') {{ uah(pendingSum) }}
        small(v-if='pending.length') {{ pending.length }} рахунк{{ pending.length === 1 ? 'а' : 'ів' }}
      .card.payments__stat
        span Оплат у місяці
        b {{ shown.filter((p) => p.status === 'paid').length }}

    form.card.payments__form(v-if='form' @submit.prevent='submit')
      .card__head
        h2.card__title {{ form.id ? 'Редагувати оплату' : 'Нова оплата' }}
        button.btn.btn--ghost.btn--sm(type='button' aria-label='Закрити' @click='form = null')
          AppIcon(name='close' :size='18')
      .payments__fields
        label.field
          | Клієнт
          select(v-model='form.client_id' required)
            option(value='' disabled) Оберіть клієнта
            option(v-for='c in clients' :key='c.id' :value='c.id') {{ c.full_name }}
        label.field
          | За що
          input(v-model='form.title' type='text' list='payment-presets' maxlength='80' required)
          datalist#payment-presets
            option(v-for='p in PRESETS' :key='p' :value='p')
        label.field
          | Сума, ₴
          input(v-model.number='form.amount' type='number' min='1' step='1' inputmode='numeric' required)
        label.field
          | Статус
          select(v-model='form.status')
            option(value='paid') Оплачено
            option(value='pending') Очікує оплати
            option(value='cancelled') Скасовано
        label.field(v-if='form.status === "paid"')
          | Дата оплати
          input(v-model='form.paid_on' type='date' :max='isoDate(now)')
        label.field(v-if='form.status === "pending"')
          | Посилання на оплату (необовʼязково)
          input(v-model='form.pay_url' type='url' placeholder='https://…' pattern='https://.*' title='Посилання має починатися з https://')
      .payments__actions
        button.btn.btn--primary(type='submit' :disabled='busy || !formValid') Зберегти
        button.btn.btn--ghost(type='button' @click='form = null') Скасувати

    section.card
      .card__head
        h2.card__title Оплати
        label.payments__filter
          span.sr-only Клієнт
          select(v-model='clientFilter')
            option(value='') Усі клієнти
            option(v-for='c in clients' :key='c.id' :value='c.id') {{ c.full_name }}
      p.empty(v-if='!shown.length') У цьому місяці оплат немає.
      .payments__table-wrap(v-else)
        table.payments__table
          thead
            tr
              th Дата
              th Клієнт
              th За що
              th.is-num Сума
              th Статус
              th
          tbody
            tr(v-for='p in shown' :key='p.id' :class='`is-${p.status}`')
              td {{ dateOf(p.paid_at || p.created_at) }}
              td: b {{ p.client ? shortName(p.client.full_name) : '—' }}
              td {{ p.title }}
              td.is-num {{ uah(p.amount_uah) }}
              td: span.payments__status(:class='`payments__status--${p.status}`') {{ STATUS[p.status] }}
              td.payments__row-actions
                button.btn.btn--soft.btn--sm(v-if='p.status === "pending"' type='button' @click='mark(p, "paid")') Оплачено
                button.btn.btn--ghost.btn--sm(type='button' @click='openForm(p)') Змінити
                button.btn.btn--ghost.btn--sm(type='button' :aria-label='`Видалити ${p.title}`' @click='remove(p)')
                  AppIcon(name='close' :size='14')
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.payments {
  &__month {
    display: flex;
    align-items: center;
    gap: 6px;

    span {
      min-width: 140px;
      font-weight: 600;
      text-align: center;
    }
  }

  &__stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 14px;
  }

  &__stat {
    display: flex;
    flex-direction: column;
    padding: 18px;
    border-radius: 18px;

    span,
    small {
      color: $text-muted;
      font-size: 13px;
    }

    b {
      font-family: $font-heading;
      font-size: 30px;
      font-weight: 500;

      &.is-warn {
        color: $text-warn;
      }
    }
  }

  &__fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
  }

  &__actions {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }

  &__filter select {
    min-height: 40px;
    padding: 6px 32px 6px 14px;
    border: 1px solid $line-green;
    border-radius: $pill;
    background: $bg-app;
    font: inherit;
    font-size: 14px;
  }

  &__table-wrap {
    overflow-x: auto;
  }

  &__table {
    width: 100%;
    min-width: 680px;
    border-collapse: collapse;
    font-size: 14px;

    th {
      padding: 10px 8px;
      border-bottom: 1px solid $line;
      color: $text-muted;
      font-weight: 600;
      text-align: left;
    }

    td {
      padding: 10px 8px;
      border-bottom: 1px solid $line-soft;
    }

    .is-num {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }

    tr.is-cancelled td {
      color: $text-faint;
      text-decoration: line-through;
    }

    tr:last-child td {
      border-bottom: 0;
    }
  }

  &__status {
    display: inline-block;
    padding: 2px 10px;
    border-radius: $pill;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;

    &--paid {
      background: $badge-bg;
      color: $text-active;
    }

    &--pending {
      background: $warn-bg;
      color: $text-warn;
    }

    &--cancelled {
      background: $bg-soft;
      color: $text-faint;
    }
  }

  &__row-actions {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
    white-space: nowrap;
  }
}
</style>
