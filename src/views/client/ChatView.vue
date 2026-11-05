<script setup lang="ts">
// Листування з Анастасією — у Telegram: там вона відповідає швидше, ніж у будь-якому
// окремому чаті, і клієнт отримує сповіщення як звичайно.
import AppIcon from '@/components/AppIcon.vue'
import { telegramApp } from '@/lib/telegram'

const CONTACT = 'nk_1802'
const link = `https://t.me/${CONTACT}`

function open(e: MouseEvent) {
  const app = telegramApp()
  if (!app) return // звичайне посилання відкриє Telegram саме
  e.preventDefault()
  app.openTelegramLink(link)
}

const TIPS = [
  'Фото тарілки — краще додати в щоденник: там Анастасія відповість коментарем.',
  'Питання про заміну страви — напишіть, яку саме і чому (алергія, немає продукту, не смакує).',
  'Аналізи завантажуйте в «Мої аналізи» — так вони не загубляться в листуванні.',
]
</script>

<template lang="pug">
main.page.chat
  .page-head
    div
      .page-head__sub Анастасія відповідає протягом дня
      h1.page-head__title Чат з нутриціологом
  section.card.chat__card
    span.chat__icon
      AppIcon(name='chat' :size='28')
    div
      h2.card__title Напишіть Анастасії в Telegram
      p.chat__muted Особисті повідомлення — @{{ CONTACT }}
    a.btn.btn--primary(:href='link' target='_blank' rel='noopener' @click='open') Відкрити чат
  section.card
    h2.card__title Щоб відповідь була швидшою
    ul.chat__tips
      li(v-for='t in TIPS' :key='t') {{ t }}
    .chat__links
      RouterLink.btn.btn--ghost.btn--sm(to='/c/diary') Щоденник
      RouterLink.btn.btn--ghost.btn--sm(to='/c/tests') Мої аналізи
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.chat {
  &__card {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;

    > div {
      flex: 1;
      min-width: 200px;
    }
  }

  &__icon {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: $bg-tint;
    color: $accent;
  }

  &__muted {
    margin: 4px 0 0;
    color: $text-muted;
  }

  &__tips {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 12px 0;
    padding-left: 20px;
    color: $text-nav;
  }

  &__links {
    display: flex;
    gap: 8px;
  }
}
</style>
