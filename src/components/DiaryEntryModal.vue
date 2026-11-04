<script setup lang="ts">
// Повний перегляд запису щоденника для нутриціолога: фото на весь розмір, що клієнт написав
// і відчував, що стояло в меню, попередні коментарі — і відповідь тут же.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAuth } from '@/stores/auth'
import { addDiaryComment, getDiaryDetails, markDiarySeen, type DiaryDetails, type DiaryItem } from '@/api/nutri'
import { longDate, timeOf } from '@/lib/dates'
import { MEAL_LABEL } from '@/lib/meals'
import { shortName } from '@/lib/clients'
import AppIcon from './AppIcon.vue'

const TEMPLATES = ['Чудова тарілка!', 'Додайте овочів — і буде ідеально.', 'Гарний баланс білка й клітковини.']

const props = defineProps<{ entry: DiaryItem; index: number; total: number }>()
const emit = defineEmits<{ close: []; prev: []; next: []; reviewed: [entry: DiaryItem] }>()

const auth = useAuth()
const details = ref<DiaryDetails | null>(null)
const detailsError = ref(false)
const comment = ref('')
const sending = ref(false)
const sendError = ref(false)
const closeBtn = ref<HTMLButtonElement | null>(null)

const scale = (v: number | null) => (v ? `${v} з 5` : '')
const when = (iso: string) => `${longDate(new Date(iso))}, ${timeOf(new Date(iso))}`

async function loadDetails() {
  details.value = null
  detailsError.value = false
  const id = props.entry.id
  try {
    const d = await getDiaryDetails(props.entry)
    if (props.entry.id === id) details.value = d
  } catch {
    if (props.entry.id === id) detailsError.value = true
  }
}

watch(
  () => props.entry.id,
  () => {
    comment.value = ''
    sendError.value = false
    loadDetails()
  },
  { immediate: true },
)

async function review(body: string | null) {
  const entry = props.entry
  if (!auth.account) return
  sending.value = true
  sendError.value = false
  try {
    if (body) await addDiaryComment(entry.id, auth.account.userId, body)
    await markDiarySeen(entry.id)
    emit('reviewed', entry)
  } catch {
    sendError.value = true
  } finally {
    sending.value = false
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') return emit('close')
  const typing = e.target instanceof HTMLElement && /^(TEXTAREA|INPUT)$/.test(e.target.tagName)
  if (typing) return
  if (e.key === 'ArrowLeft' && props.index > 0) emit('prev')
  if (e.key === 'ArrowRight' && props.index < props.total - 1) emit('next')
}

const lastFocus = document.activeElement as HTMLElement | null
onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
  nextTick(() => closeBtn.value?.focus())
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
  lastFocus?.focus?.()
})
</script>

<template lang="pug">
.entry-modal(@click.self='emit("close")')
  section.entry-modal__box(role='dialog' aria-modal='true' :aria-label='`Запис у щоденнику: ${entry.client ? entry.client.full_name : "клієнт"}`')
    .entry-modal__media(:class='{ "is-empty": !entry.photoUrl }')
      img(v-if='entry.photoUrl' :src='entry.photoUrl' :alt='`Фото: ${entry.meal ? MEAL_LABEL[entry.meal] : "прийом їжі"}`')
      .entry-modal__nophoto(v-else)
        AppIcon(name='camera' :size='28')
        span Без фото — лише нотатка
      .entry-modal__nav(v-if='total > 1')
        button(type='button' aria-label='Попередній запис' :disabled='index === 0' @click='emit("prev")')
          AppIcon(name='chevronLeft' :size='20')
        span {{ index + 1 }} / {{ total }}
        button(type='button' aria-label='Наступний запис' :disabled='index >= total - 1' @click='emit("next")')
          AppIcon(name='chevronRight' :size='20')

    .entry-modal__side
      header.entry-modal__head
        div
          .eyebrow {{ entry.meal ? MEAL_LABEL[entry.meal] : 'Запис' }} · {{ when(entry.taken_at) }}
          h2.card__title {{ entry.client ? entry.client.full_name : 'Клієнт' }}
          RouterLink.entry-modal__link(v-if='entry.client' :to='`/n/clients/${entry.client.id}`') Картка клієнта
        button.btn.btn--ghost.btn--sm.entry-modal__close(ref='closeBtn' type='button' aria-label='Закрити' @click='emit("close")')
          AppIcon(name='close' :size='18')

      .entry-modal__block(v-if='details && details.planned')
        span.entry-modal__label За меню
        p.entry-modal__plan
          b {{ details.planned.title }}
          span.chip(v-if='details.planned.eaten') відмічено «зʼїдено»
        RouterLink.entry-modal__link(v-if='details.planned.recipe_id' :to='`/n/recipes/${details.planned.recipe_id}`') Рецепт
      p.entry-modal__muted(v-else-if='details && entry.meal') У меню на цей прийом нічого не стояло.

      .entry-modal__block
        span.entry-modal__label Клієнт написав
        blockquote.entry-modal__note(v-if='entry.note') {{ entry.note }}
        p.entry-modal__muted(v-else) Без нотатки.

      .entry-modal__feel(v-if='entry.hunger || entry.fullness || entry.mood')
        div(v-if='entry.hunger')
          span Голод до
          b {{ scale(entry.hunger) }}
        div(v-if='entry.fullness')
          span Ситість після
          b {{ scale(entry.fullness) }}
        div(v-if='entry.mood')
          span Настрій
          b {{ entry.mood }}

      .entry-modal__block(v-if='details && details.comments.length')
        span.entry-modal__label Ваші коментарі
        p.entry-modal__comment(v-for='c in details.comments' :key='c.id')
          | {{ c.body }}
          small {{ when(c.created_at) }}
      p.notice(v-if='detailsError' role='alert') Не вдалося завантажити меню й коментарі.

      form.entry-modal__reply(@submit.prevent='review(comment.trim())')
        label.field
          | Коментар для {{ entry.client ? shortName(entry.client.full_name) : 'клієнта' }}
          textarea(v-model='comment' rows='3' placeholder='Напишіть відгук на прийом їжі…')
        .entry-modal__templates
          button.btn.btn--soft.btn--sm(v-for='t in TEMPLATES' :key='t' type='button' :disabled='sending' @click='review(t)') «{{ t }}»
        p.notice(v-if='sendError' role='alert') Не вдалося зберегти. Спробуйте ще раз.
        .entry-modal__actions
          button.btn.btn--primary(type='submit' :disabled='sending || !comment.trim()') Надіслати
          button.btn.btn--ghost(type='button' :disabled='sending' @click='review(null)') Переглянуто без коментаря
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.entry-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(20, 38, 27, 0.45);

  @media (max-width: $bp-md) {
    align-items: flex-end;
    padding: 0;
  }

  &__box {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    width: 100%;
    max-width: 980px;
    height: min(680px, calc(100vh - 32px));
    overflow: hidden;
    border-radius: $radius-card;
    background: $bg;
    box-shadow: 0 24px 60px rgba(20, 38, 27, 0.25);
    animation: entry-modal-in 0.2s ease-out;

    @media (max-width: $bp-md) {
      display: block;
      height: auto;
      max-height: 94vh;
      overflow-y: auto;
      border-radius: $radius-card $radius-card 0 0;
    }
  }

  &__media {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    background: #13201a;

    img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    &.is-empty {
      background: $bg-soft;
    }

    @media (max-width: $bp-md) {
      height: 46vh;

      &.is-empty {
        height: 120px;
      }
    }
  }

  &__nophoto {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: $text-faint;
    font-size: 14px;
  }

  &__nav {
    position: absolute;
    bottom: 14px;
    left: 50%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px;
    border-radius: $pill;
    background: rgba(255, 255, 255, 0.92);
    color: $text;
    font-size: 13px;
    font-weight: 600;
    transform: translateX(-50%);

    button {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: inherit;
      cursor: pointer;

      &:hover:not(:disabled) {
        background: $bg-tint;
      }

      &:disabled {
        opacity: 0.35;
        cursor: default;
      }
    }
  }

  &__side {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
    padding: 22px;
    overflow-y: auto;

    @media (max-width: $bp-md) {
      overflow: visible;
      padding-bottom: calc(22px + env(safe-area-inset-bottom));
    }
  }

  &__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;

    .card__title {
      margin: 2px 0;
    }
  }

  &__close {
    flex: none;
  }

  &__link {
    color: $green-link;
    font-size: 13px;
    font-weight: 600;

    &:hover {
      color: $green-link-hover;
    }
  }

  &__block {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  &__label {
    color: $text-muted;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }

  &__plan {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0;
  }

  &__note {
    margin: 0;
    padding: 12px 14px;
    border-left: 3px solid $accent;
    border-radius: 0 $radius-item $radius-item 0;
    background: $bg-soft;
    white-space: pre-line;
  }

  &__muted {
    margin: 0;
    color: $text-faint;
    font-size: 14px;
  }

  &__feel {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 8px;

    div {
      display: flex;
      flex-direction: column;
      padding: 10px 12px;
      border: 1px solid $line;
      border-radius: $radius-item;
    }

    span {
      color: $text-muted;
      font-size: 12px;
    }
  }

  &__comment {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 10px 12px;
    border-radius: $radius-item;
    background: $bg-selected;
    white-space: pre-line;

    small {
      color: $text-faint;
      font-size: 12px;
    }
  }

  &__reply {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: auto;
    padding-top: 14px;
    border-top: 1px solid $line;
  }

  &__templates,
  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
}

@keyframes entry-modal-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
  }
}

@media (prefers-reduced-motion: reduce) {
  .entry-modal__box {
    animation: none;
  }
}
</style>
