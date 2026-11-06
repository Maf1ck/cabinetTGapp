<script setup lang="ts">
// Страва з меню клієнта: фото, склад, приготування і відмітка «зʼїдено» в одному вікні.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { getRecipe, type Recipe } from '@/api/recipes'
import type { Meal } from '@/api/client'
import { hhmm, MEAL_LABEL } from '@/lib/meals'

// needsReport: клієнт на супроводі, «зʼїдено» ставиться лише зі звітом
const props = defineProps<{ meal: Meal; needsReport?: boolean }>()
const emit = defineEmits<{ close: []; toggle: [] }>()

const recipe = ref<Recipe | null>(null)
const loading = ref(false)
const loadError = ref(false)
const closeBtn = ref<HTMLButtonElement | null>(null)

const toggleLabel = computed(() => {
  if (props.meal.eaten) return 'Зʼїдено. Зняти відмітку'
  return props.needsReport ? 'Зʼїли? Надішліть фото чи коментар' : 'Відмітити зʼїденим'
})
const steps = computed(() => (recipe.value?.instructions ?? '').split(/\n+/).filter((p) => p.trim()))

async function load() {
  if (!props.meal.recipe_id) return
  loading.value = true
  loadError.value = false
  try {
    recipe.value = await getRecipe(props.meal.recipe_id)
    if (!recipe.value) loadError.value = true
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  load()
  window.addEventListener('keydown', onKey)
  closeBtn.value?.focus()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template lang="pug">
.meal-dialog(@click.self='emit("close")')
  section.meal-dialog__box(role='dialog' aria-modal='true' :aria-label='meal.title')
    button.btn.btn--white.btn--sm.meal-dialog__close(ref='closeBtn' type='button' aria-label='Закрити' @click='emit("close")')
      AppIcon(name='close' :size='18')

    .meal-dialog__scroll
      .meal-dialog__photo(v-if='meal.photoUrl')
        img(:src='meal.photoUrl' :alt='meal.title')
        a.meal-dialog__credit(v-if='meal.photoCredit' :href='recipe?.photo_source || undefined' target='_blank' rel='noopener noreferrer') Фото: {{ meal.photoCredit }}

      .meal-dialog__body
        div
          .eyebrow {{ MEAL_LABEL[meal.meal] }}{{ meal.at_time ? ` · ${hhmm(meal.at_time)}` : '' }}
          h2.meal-dialog__title {{ meal.title }}
          .meal-dialog__tags(v-if='recipe && (recipe.category || recipe.servings)')
            span.chip(v-if='recipe.category') {{ recipe.category }}
            span.chip.chip--plain(v-if='recipe.servings') Порцій: {{ recipe.servings }}

        p.empty(v-if='loading') Відкриваємо рецепт…
        p.notice(v-else-if='loadError' role='alert')
          | Не вдалося відкрити рецепт.
          |
          button.btn.btn--soft.btn--sm(type='button' @click='load') Спробувати ще раз
        template(v-else-if='recipe')
          section.meal-dialog__block
            h3 Інгредієнти
            p.empty(v-if='!recipe.lines.length') Склад не вказано.
            ul.meal-dialog__lines(v-else)
              li(v-for='l in recipe.lines' :key='l.id')
                span
                  | {{ l.name }}
                  small(v-if='l.note') {{ l.note }}
                b {{ l.amount || '' }}
          section.meal-dialog__block
            h3 Приготування
            p.empty(v-if='!steps.length') Інструкції поки немає.
            ol.meal-dialog__steps(v-else-if='steps.length > 1')
              li(v-for='(p, i) in steps' :key='i') {{ p }}
            p.meal-dialog__text(v-else) {{ steps[0] }}
            .tip(v-if='recipe.notes') #[b Примітка.] {{ recipe.notes }}
        p.empty(v-else) Для цієї страви немає окремого рецепта. Якщо щось незрозуміло, запитайте Анастасію в чаті.

    .meal-dialog__foot
      button.btn(type='button' :class='meal.eaten ? "btn--ghost" : "btn--primary"' @click='emit("toggle")')
        AppIcon(v-if='meal.eaten' name='check' :size='16')
        | {{ toggleLabel }}
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.meal-dialog {
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
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 560px;
    max-height: calc(100vh - 32px);
    overflow: hidden;
    border-radius: $radius-card;
    background: $bg;

    @media (max-width: $bp-md) {
      max-width: none;
      max-height: 92vh;
      border-radius: $radius-card $radius-card 0 0;
    }
  }

  &__close {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 1;
    width: 38px;
    padding: 0;
  }

  &__scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  &__photo {
    position: relative;

    img {
      display: block;
      width: 100%;
      height: 230px;
      object-fit: cover;
    }
  }

  &__credit {
    position: absolute;
    right: 8px;
    bottom: 8px;
    max-width: calc(100% - 16px);
    padding: 2px 8px;
    overflow: hidden;
    border-radius: $pill;
    background: rgba(20, 38, 27, 0.6);
    color: #fff;
    font-size: 11px;
    text-decoration: none;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 22px;
  }

  &__title {
    margin: 2px 44px 0 0;
    font-family: $font-heading;
    font-size: 24px;
    font-weight: 500;
    line-height: 1.2;
  }

  &__photo + &__body &__title {
    margin-right: 0;
  }

  &__tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  &__block h3 {
    margin: 0 0 8px;
    font-family: $font-body;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: $text-muted;
  }

  &__lines {
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 7px 0;
      border-bottom: 1px solid $line-soft;
    }

    li:last-child {
      border-bottom: 0;
    }

    small {
      display: block;
      color: $text-faint;
      font-size: 12px;
    }

    b {
      flex: none;
      font-weight: 600;
    }
  }

  &__steps {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding-left: 20px;
  }

  &__text {
    margin: 0;
    white-space: pre-line;
  }

  &__foot {
    display: flex;
    padding: 14px 22px;
    padding-bottom: calc(14px + env(safe-area-inset-bottom));
    border-top: 1px solid $line;

    .btn {
      flex: 1;
    }
  }
}
</style>
