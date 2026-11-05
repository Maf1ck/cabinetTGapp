<script setup lang="ts">
// Аналізи клієнта: список файлів і (для клієнта) завантаження. Той самий компонент —
// на сторінці «Мої аналізи» і в картці клієнта в нутриціолога.
import { onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { deleteLab, LAB_ACCEPT, LAB_MAX_MB, listLabs, uploadLab, type LabFile } from '@/api/labs'
import { shortDate } from '@/lib/dates'

const props = defineProps<{ clientId: string; canUpload?: boolean }>()

const files = ref<LabFile[]>([])
const loading = ref(true)
const loadError = ref(false)
const error = ref('')
const uploading = ref(false)
const title = ref('')
const picked = ref<File | null>(null)
const input = ref<HTMLInputElement | null>(null)

const isPdf = (f: LabFile) => /\.pdf$/i.test(f.file_path)

async function load() {
  loading.value = true
  loadError.value = false
  try {
    files.value = await listLabs(props.clientId)
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function pick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null
  error.value = ''
  if (f && f.size > LAB_MAX_MB * 1024 * 1024) {
    error.value = `Файл більший за ${LAB_MAX_MB} МБ. Стисніть фото або розбийте PDF.`
    picked.value = null
    return
  }
  picked.value = f
  if (f && !title.value) title.value = f.name.replace(/\.[^.]+$/, '')
}

async function upload() {
  if (!picked.value) return
  uploading.value = true
  error.value = ''
  try {
    files.value.unshift(await uploadLab(props.clientId, picked.value, title.value.trim() || 'Аналізи'))
    picked.value = null
    title.value = ''
    if (input.value) input.value.value = ''
  } catch {
    error.value = 'Не вдалося завантажити файл. Спробуйте ще раз.'
  } finally {
    uploading.value = false
  }
}

async function remove(f: LabFile) {
  if (!confirm(`Видалити «${f.title}»?`)) return
  try {
    await deleteLab(f)
    files.value = files.value.filter((x) => x.id !== f.id)
  } catch {
    error.value = 'Не вдалося видалити файл.'
  }
}

watch(() => props.clientId, load)
onMounted(load)
</script>

<template lang="pug">
.labs
  form.labs__upload(v-if='canUpload' @submit.prevent='upload')
    label.labs__drop(:class='{ "is-picked": picked }')
      input(ref='input' type='file' :accept='LAB_ACCEPT' @change='pick')
      AppIcon(name='flask' :size='22')
      span(v-if='picked') {{ picked.name }}
      span(v-else) Оберіть файл: PDF або фото бланка (до {{ LAB_MAX_MB }} МБ)
    label.field(v-if='picked')
      | Назва
      input(v-model='title' type='text' maxlength='80' placeholder='Напр.: Загальний аналіз крові, жовтень')
    button.btn.btn--primary(v-if='picked' type='submit' :disabled='uploading') {{ uploading ? 'Завантажуємо…' : 'Завантажити' }}

  p.notice(v-if='error' role='alert') {{ error }}
  p.empty(v-if='loading') Завантажуємо…
  p.empty(v-else-if='loadError')
    | Не вдалося завантажити список.
    |
    button.btn.btn--soft.btn--sm(type='button' @click='load') Спробувати ще раз
  p.empty(v-else-if='!files.length') {{ canUpload ? 'Тут зʼявляться ваші аналізи — Анастасія побачить їх одразу.' : 'Клієнт ще не додав аналізів.' }}
  ul.labs__list(v-else)
    li(v-for='f in files' :key='f.id')
      a.labs__file(:href='f.url || undefined' target='_blank' rel='noopener')
        span.labs__icon {{ isPdf(f) ? 'PDF' : 'ФОТО' }}
        span
          b {{ f.title }}
          small {{ shortDate(new Date(f.uploaded_at)) }}
      button.labs__remove(v-if='canUpload' type='button' :aria-label='`Видалити ${f.title}`' @click='remove(f)')
        AppIcon(name='close' :size='14')
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.labs {
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__upload {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__drop {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px;
    border: 2px dashed $line-dashed;
    border-radius: $radius-item;
    background: $bg-soft;
    color: $text-nav;
    cursor: pointer;

    &:hover,
    &:focus-within {
      border-color: $accent;
    }

    &.is-picked {
      border-style: solid;
      background: $bg-selected;
    }

    input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
    }
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      align-items: center;
      gap: 6px;
    }
  }

  &__file {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid $line;
    border-radius: $radius-item;
    color: $text;
    text-decoration: none;

    &:hover {
      border-color: $accent;
    }

    span:last-child {
      display: flex;
      flex-direction: column;
    }

    small {
      color: $text-faint;
      font-size: 12px;
    }
  }

  &__icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    background: $bg-tint;
    color: $green-dark;
    font-size: 11px;
    font-weight: 800;
  }

  &__remove {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: $text-faint;
    cursor: pointer;

    &:hover {
      background: $bg-soft;
      color: $text;
    }
  }
}
</style>
