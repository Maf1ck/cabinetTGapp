<script setup lang="ts">
// Звіт клієнта на супроводі про зʼїдену страву: фото тарілки або, якщо сфотографувати
// не вийшло, коментар. Звіт іде в щоденник (Анастасія бачить його в «Нових записах»),
// і лише після цього страва відмічається «зʼїдено» — інакше база відмітку не прийме.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { addDiaryEntry, setMealEaten, type DiaryEntry, type Meal } from '@/api/client'
import { hhmm, MEAL_LABEL, REPORT_NOTE_MAX, reportNote, reportTime } from '@/lib/meals'
import { compressImage, MAX_UPLOAD_BYTES } from '@/lib/image'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ clientId: string; meal: Meal; weekMonday: Date }>()
const emit = defineEmits<{ close: []; done: [entry: DiaryEntry] }>()

const photo = ref<File | null>(null)
const preview = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)
const comment = ref('')
const saving = ref(false)
const error = ref('')
/** запис уже в щоденнику, не вдалося лише відмітити — повтор не дублює запис */
const saved = ref<DiaryEntry | null>(null)

const canSave = computed(() => !saving.value && (!!saved.value || !!photo.value || !!comment.value.trim()))

function pickPhoto(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    error.value = 'Оберіть фото.'
    return
  }
  if (file.size > MAX_UPLOAD_BYTES * 3) {
    error.value = 'Фото завелике.'
    return
  }
  error.value = ''
  photo.value = file
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = URL.createObjectURL(file)
}

function clearPhoto() {
  photo.value = null
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = null
  if (fileInput.value) fileInput.value.value = ''
}

async function submit() {
  if (!canSave.value) return
  saving.value = true
  error.value = ''
  try {
    if (!saved.value) {
      const blob = photo.value ? await compressImage(photo.value) : null
      if (blob && blob.size > MAX_UPLOAD_BYTES) throw new Error('too_big')
      saved.value = await addDiaryEntry(
        props.clientId,
        {
          meal: props.meal.meal,
          note: reportNote(props.meal.title, comment.value),
          hunger: null,
          fullness: null,
          mood: null,
          taken_at: reportTime(props.weekMonday, props.meal, new Date()).toISOString(),
          menu_meal_id: props.meal.id,
        },
        blob,
      )
    }
    await setMealEaten(props.clientId, props.meal.id, true)
    emit('done', saved.value)
  } catch (e) {
    error.value =
      e instanceof Error && e.message === 'too_big'
        ? 'Фото завелике навіть після стиснення. Спробуйте інше.'
        : saved.value
          ? 'Звіт збережено в щоденнику, але відмітку поставити не вдалося. Спробуйте ще раз.'
          : 'Не вдалося надіслати звіт. Перевірте інтернет і спробуйте ще раз.'
  } finally {
    saving.value = false
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !saving.value) emit('close')
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
  if (preview.value) URL.revokeObjectURL(preview.value)
  lastFocus?.focus?.()
})
</script>

<template lang="pug">
.report-modal(@click.self='!saving && emit("close")')
  form.report-modal__box(role='dialog' aria-modal='true' aria-labelledby='report-title' @submit.prevent='submit')
    header.report-modal__head
      div
        .eyebrow {{ MEAL_LABEL[meal.meal] }}{{ meal.at_time ? ` · ${hhmm(meal.at_time)}` : '' }}
        h2#report-title.card__title {{ meal.title }}
      button.btn.btn--ghost.btn--sm(ref='closeBtn' type='button' aria-label='Закрити' :disabled='saving' @click='emit("close")')
        AppIcon(name='close' :size='18')

    p.report-modal__lead Ви на супроводі — Анастасія дивиться на кожну тарілку. Надішліть фото страви, а якщо сфотографувати не вийшло, напишіть коментар.

    template(v-if='!saved')
      input.sr-only(ref='fileInput' type='file' accept='image/*' capture='environment' @change='pickPhoto')
      .report-modal__preview(v-if='preview')
        img(:src='preview' alt='Обране фото')
        button.btn.btn--white.btn--sm(type='button' @click='clearPhoto') Інше фото
      button.report-modal__shot(v-else type='button' @click='fileInput?.click()')
        AppIcon(name='camera' :size='26')
        | Сфотографувати тарілку

      label.field
        | {{ photo ? 'Коментар (необовʼязково)' : 'Коментар, якщо без фото' }}
        textarea(
          v-model='comment'
          rows='3'
          :maxlength='REPORT_NOTE_MAX'
          placeholder='Напр.: зʼїла половину, замінила рис на гречку, не встигла сфотографувати…'
        )

    p.notice(v-if='error' role='alert') {{ error }}
    .report-modal__actions
      button.btn.btn--primary(type='submit' :disabled='!canSave')
        | {{ saving ? 'Надсилаємо…' : saved ? 'Спробувати ще раз' : "Надіслати й відмітити з'їденим" }}
      button.btn.btn--ghost(type='button' :disabled='saving' @click='emit("close")') Скасувати
    p.report-modal__hint(v-if='!saved && !photo && !comment.trim()') Додайте фото або напишіть коментар.
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.report-modal {
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
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    max-width: 460px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: 22px;
    border-radius: $radius-card;
    background: $bg;
    box-shadow: 0 24px 60px rgba(20, 38, 27, 0.25);
    animation: report-modal-in 0.2s ease-out;

    @media (max-width: $bp-md) {
      max-width: none;
      max-height: 94vh;
      border-radius: $radius-card $radius-card 0 0;
    }
  }

  &__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  &__lead,
  &__hint {
    margin: 0;
    color: $text-faint;
    font-size: 14px;
  }

  &__hint {
    text-align: center;
    font-size: 13px;
  }

  &__shot {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 120px;
    border: 2px dashed $line-dashed;
    border-radius: 16px;
    background: $bg;
    color: $green-link;
    font: inherit;
    font-weight: 700;
    cursor: pointer;

    &:hover {
      border-color: $accent;
    }
  }

  &__preview {
    position: relative;
    overflow: hidden;
    border-radius: 16px;

    img {
      display: block;
      width: 100%;
      max-height: 260px;
      object-fit: cover;
    }

    .btn {
      position: absolute;
      right: 10px;
      bottom: 10px;
    }
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
}

@keyframes report-modal-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
  }
}

@media (prefers-reduced-motion: reduce) {
  .report-modal__box {
    animation: none;
  }
}
</style>
