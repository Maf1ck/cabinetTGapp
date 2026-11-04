<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import {
  createClientCard,
  createInviteLink,
  listClients,
  updateClientCard,
  type ClientDraft,
  type ClientRow,
} from '@/api/nutri'
import { shortDate } from '@/lib/dates'
import { initials, programLabel, shortName } from '@/lib/clients'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const loadError = ref(false)
const clients = ref<ClientRow[]>([])
const search = ref('')

const emptyDraft = (): ClientDraft => ({
  full_name: '',
  goal: '',
  program_title: 'Супровід',
  program_week: 1,
  program_weeks: 4,
})
const draft = ref<ClientDraft>(emptyDraft())
const editing = ref(false)
const saving = ref(false)
const formError = ref('')

const invite = ref<{ clientId: string; link: string } | null>(null)
const inviting = ref(false)
const inviteError = ref('')
const copied = ref(false)

const creating = computed(() => route.query.new === '1')
const selectedId = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))
const selected = computed(() => clients.value.find((c) => c.id === selectedId.value) ?? null)
const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? clients.value.filter((c) => c.full_name.toLowerCase().includes(q)) : clients.value
})
const counts = computed(() => {
  const active = clients.value.filter((c) => c.active).length
  return `${active} активних · ${clients.value.length - active} призупинено`
})
const showForm = computed(() => creating.value || editing.value)

function status(c: ClientRow): { text: string; kind: 'ok' | 'wait' | 'off' } {
  if (!c.active) return { text: 'Доступ призупинено', kind: 'off' }
  if (!c.user_id) return { text: 'Очікує запрошення', kind: 'wait' }
  return { text: 'Підключений у Telegram', kind: 'ok' }
}

async function load() {
  loading.value = true
  loadError.value = false
  try {
    clients.value = await listClients()
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// Порожні рядки → null, номери тижнів у межах
function clean(d: ClientDraft): ClientDraft {
  const num = (v: number | null) => (v && v > 0 ? Math.round(v) : null)
  return {
    full_name: d.full_name.trim(),
    goal: d.goal?.trim() || null,
    program_title: d.program_title?.trim() || null,
    program_week: num(d.program_week),
    program_weeks: num(d.program_weeks),
  }
}

async function submit() {
  const data = clean(draft.value)
  if (!data.full_name) {
    formError.value = 'Вкажіть імʼя клієнта.'
    return
  }
  if (data.program_week && data.program_weeks && data.program_week > data.program_weeks) {
    formError.value = 'Поточний тиждень не може бути більшим за тривалість програми.'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    if (editing.value && selected.value) {
      const row = await updateClientCard(selected.value.id, data)
      clients.value = clients.value.map((c) => (c.id === row.id ? row : c))
      editing.value = false
    } else {
      const row = await createClientCard(data)
      clients.value = [...clients.value, row].sort((a, b) => a.full_name.localeCompare(b.full_name, 'uk'))
      await router.replace(`/n/clients/${row.id}`)
    }
  } catch {
    formError.value = 'Не вдалося зберегти. Перевірте інтернет і спробуйте ще раз.'
  } finally {
    saving.value = false
  }
}

function startCreate() {
  editing.value = false
  draft.value = emptyDraft()
  formError.value = ''
  router.push({ path: '/n/clients', query: { new: '1' } })
}

function startEdit() {
  const c = selected.value
  if (!c) return
  draft.value = {
    full_name: c.full_name,
    goal: c.goal ?? '',
    program_title: c.program_title ?? '',
    program_week: c.program_week,
    program_weeks: c.program_weeks,
  }
  formError.value = ''
  editing.value = true
}

function cancelForm() {
  if (editing.value) editing.value = false
  else router.push('/n/clients')
}

async function toggleActive() {
  const c = selected.value
  if (!c) return
  const question = c.active
    ? `Призупинити доступ для ${c.full_name}? Клієнт перестане бачити свій кабінет, дані збережуться.`
    : `Відновити доступ для ${c.full_name}?`
  if (!window.confirm(question)) return
  try {
    const row = await updateClientCard(c.id, { active: !c.active })
    clients.value = clients.value.map((x) => (x.id === row.id ? row : x))
  } catch {
    inviteError.value = 'Не вдалося змінити доступ. Спробуйте ще раз.'
  }
}

async function makeInvite() {
  const c = selected.value
  if (!c) return
  inviting.value = true
  inviteError.value = ''
  copied.value = false
  try {
    invite.value = { clientId: c.id, link: await createInviteLink(c.id) }
  } catch (e) {
    inviteError.value =
      e instanceof Error && e.message === 'already_joined'
        ? 'Клієнт уже підключився.'
        : 'Не вдалося створити запрошення. Спробуйте ще раз.'
  } finally {
    inviting.value = false
  }
}

const selectAll = (e: FocusEvent) => (e.target as HTMLInputElement).select()

async function copyInvite() {
  if (!invite.value) return
  try {
    await navigator.clipboard.writeText(invite.value.link)
    copied.value = true
  } catch {
    copied.value = false
  }
}

// Інший клієнт або нова форма: скидаємо стан картки
watch([selectedId, creating], () => {
  editing.value = false
  inviteError.value = ''
  copied.value = false
  if (creating.value) draft.value = emptyDraft()
})

onMounted(load)
</script>

<template lang="pug">
main.page.clients
  .page-head
    div
      .page-head__sub(v-if='!loading && !loadError') {{ counts }}
      h1.page-head__title Клієнти
    button.btn.btn--primary(type='button' @click='startCreate') + Новий клієнт

  p.empty(v-if='loading') Завантажуємо…
  p.empty(v-else-if='loadError')
    | Не вдалося завантажити клієнтів.
    |
    button.btn.btn--soft.btn--sm(type='button' @click='load') Спробувати ще раз

  .clients__layout(v-else)
    //- список
    section.card.clients__list(:class='{ "clients__list--hidden": selected || showForm }')
      label.clients__search
        span.sr-only Пошук клієнта
        input(v-model='search' type='search' placeholder='Пошук клієнта')
      p.empty(v-if='!clients.length') Клієнтів поки немає. Додайте першого.
      p.empty(v-else-if='!shown.length') Нікого не знайдено.
      RouterLink.clients__item(
        v-for='c in shown'
        :key='c.id'
        :to='`/n/clients/${c.id}`'
        :class='{ "is-on": c.id === selectedId, "is-off": !c.active }'
      )
        span.clients__avatar {{ initials(c.full_name) }}
        span.clients__item-text
          b {{ shortName(c.full_name) }}
          span(:class='`is-${status(c).kind}`') {{ c.user_id && c.active ? (programLabel(c) || c.goal || status(c).text) : status(c).text }}

    //- форма нового клієнта / редагування
    section.card.clients__form(v-if='showForm')
      h2.card__title {{ editing ? 'Редагувати картку' : 'Новий клієнт' }}
      form.clients__fields(@submit.prevent='submit')
        label.field
          | Імʼя та прізвище *
          input(v-model='draft.full_name' type='text' autocomplete='off' placeholder='Марія Кравець' required)
        label.field
          | Ціль
          input(v-model='draft.goal' type='text' placeholder='Більше енергії, режим харчування…')
        .clients__grid
          label.field
            | Програма
            input(v-model='draft.program_title' type='text' placeholder='Супровід')
          label.field
            | Поточний тиждень
            input(v-model.number='draft.program_week' type='number' min='1' max='52')
          label.field
            | Тижнів усього
            input(v-model.number='draft.program_weeks' type='number' min='1' max='52')
        p.notice(v-if='formError' role='alert') {{ formError }}
        .clients__actions
          button.btn.btn--primary(type='submit' :disabled='saving') {{ saving ? 'Зберігаємо…' : editing ? 'Зберегти' : 'Створити клієнта' }}
          button.btn.btn--ghost(type='button' @click='cancelForm') Скасувати
        p.clients__hint(v-if='!editing') Після створення ви отримаєте посилання-запрошення: клієнт відкриє його в Telegram і одразу потрапить у свій кабінет.

    //- картка клієнта
    section.card.clients__card(v-else-if='selected')
      RouterLink.clients__back(to='/n/clients')
        AppIcon(name='chevronLeft' :size='18')
        | Усі клієнти
      .clients__head
        span.clients__avatar.clients__avatar--big {{ initials(selected.full_name) }}
        div
          h2.clients__name {{ selected.full_name }}
          .clients__muted {{ programLabel(selected) || 'Програму не вказано' }} · з {{ shortDate(new Date(selected.created_at)) }}
          span.clients__status(:class='`is-${status(selected).kind}`') {{ status(selected).text }}

      .clients__facts
        div
          span Ціль
          b {{ selected.goal || '—' }}
        div
          span Програма
          b {{ programLabel(selected) || '—' }}

      //- запрошення
      .clients__invite(v-if='selected.active && !selected.user_id')
        b Запросіть клієнта в кабінет
        p.clients__muted Посилання одноразове і діє 7 днів. Надішліть його клієнту в Telegram або Viber.
        .clients__link(v-if='invite?.clientId === selected.id')
          input(:value='invite.link' readonly aria-label='Посилання-запрошення' @focus='selectAll')
          button.btn.btn--soft(type='button' @click='copyInvite')
            AppIcon(:name='copied ? "check" : "copy"' :size='18')
            | {{ copied ? 'Скопійовано' : 'Копіювати' }}
        button.btn.btn--primary(v-else type='button' :disabled='inviting' @click='makeInvite') {{ inviting ? 'Створюємо…' : 'Створити запрошення' }}

      p.notice(v-if='inviteError' role='alert') {{ inviteError }}

      .clients__actions
        RouterLink.btn.btn--primary(v-if='selected.active' :to='{ path: "/n/builder", query: { client: selected.id } }') Скласти меню
        button.btn.btn--ghost(type='button' @click='startEdit') Редагувати
        button.btn.btn--ghost(type='button' @click='toggleActive') {{ selected.active ? 'Призупинити доступ' : 'Відновити доступ' }}

    section.card.clients__placeholder(v-else-if='clients.length')
      p.empty Оберіть клієнта зі списку або додайте нового.
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.clients {
  &__layout {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 22px;
  }

  &__list {
    display: flex;
    flex: 1 1 280px;
    flex-direction: column;
    gap: 4px;
    padding: 12px;

    // на телефоні список ховається, коли відкрита картка чи форма
    @media (max-width: $bp-md) {
      &--hidden {
        display: none;
      }
    }
  }

  &__search {
    display: flex;
    padding: 6px 6px 10px;

    input {
      flex: 1;
      min-height: 44px;
      padding: 10px 14px;
      border: 1px solid $line-green;
      border-radius: $pill;
      background: $bg-app;
      font: inherit;
    }
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 16px;
    color: $text;
    text-decoration: none;

    &:hover {
      background: $bg-soft;
      color: $text;
    }

    &.is-on {
      background: $bg-active;

      .clients__avatar {
        background: $accent;
        color: #fff;
      }
    }

    &.is-off {
      opacity: 0.65;
    }
  }

  &__item-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;

    span {
      overflow: hidden;
      color: $text-muted;
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;

      &.is-wait {
        color: $text-warn;
      }
    }
  }

  &__avatar {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: $line;
    font-weight: 700;

    &--big {
      width: 64px;
      height: 64px;
      background: $accent;
      color: #fff;
      font-family: $font-heading;
      font-size: 24px;
      font-weight: 600;
    }
  }

  &__form,
  &__card,
  &__placeholder {
    display: flex;
    flex: 999 1 480px;
    flex-direction: column;
    gap: 18px;
  }

  &__fields {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  &__grid {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: 12px;

    @media (max-width: $bp-md) {
      grid-template-columns: 1fr 1fr;

      .field:first-child {
        grid-column: 1 / -1;
      }
    }
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__hint,
  &__muted {
    color: $text-muted;
    font-size: 14px;
  }

  &__back {
    display: none;
    align-items: center;
    gap: 4px;
    font-size: 14px;
    font-weight: 700;
    text-decoration: none;

    @media (max-width: $bp-md) {
      display: inline-flex;
    }
  }

  &__head {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  &__name {
    font-size: 28px;

    @media (max-width: $bp-md) {
      font-size: 23px;
    }
  }

  &__status {
    display: inline-block;
    margin-top: 6px;
    padding: 3px 10px;
    border-radius: $pill;
    font-size: 13px;
    font-weight: 700;

    &.is-ok {
      background: $bg-active;
      color: $text-active;
    }

    &.is-wait {
      background: $warn-bg;
      color: $text-warn;
    }

    &.is-off {
      background: $line;
      color: $text-nav;
    }
  }

  &__facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;

    div {
      display: flex;
      flex-direction: column;
      padding: 14px;
      border-radius: 16px;
      background: $bg-soft;
    }

    span {
      color: $text-muted;
      font-size: 13px;
    }
  }

  &__invite {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding: 18px;
    border: 2px dashed $line-dashed;
    border-radius: 18px;
  }

  &__link {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    width: 100%;

    input {
      flex: 1 1 240px;
      min-height: 44px;
      padding: 10px 14px;
      border: 1px solid $line-green;
      border-radius: $radius-item;
      background: $bg-app;
      font: inherit;
      font-size: 14px;
    }
  }
}
</style>
