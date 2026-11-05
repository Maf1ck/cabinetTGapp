<script setup lang="ts">
// Підказка «як цим користуватися». Закрили — більше не показуємо (запамʼятовуємо на пристрої).
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ id: string; title: string }>()

const KEY = `cabinet.hint.${props.id}`
const read = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
const hidden = ref(read())

function dismiss() {
  hidden.value = true
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // приватний режим — підказка просто зʼявиться знову
  }
}
</script>

<template lang="pug">
Transition(name='hint')
  aside.hint(v-if='!hidden' :aria-label='title')
    span.hint__icon: AppIcon(name='bulb' :size='20')
    .hint__body
      b {{ title }}
      slot
    button.btn.btn--ghost.btn--sm.hint__ok(type='button' @click='dismiss') Зрозуміло
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.hint {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid $line-green;
  border-radius: $radius-item;
  background: $bg-soft;
  color: $text-nav;
  font-size: 14px;

  &__icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: $bg-active;
    color: $green-link;
  }

  &__body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;

    b {
      color: $text;
    }

    ul {
      margin: 0;
      padding-left: 18px;
    }

    p {
      margin: 0;
    }
  }

  &__ok {
    flex: none;
  }

  @media (max-width: $bp-md) {
    flex-wrap: wrap;

    &__ok {
      margin-left: 48px;
    }
  }
}

.hint-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

.hint-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
