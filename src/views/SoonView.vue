<script setup lang="ts">
// Розділи, які ще в роботі: навігація вже веде сюди, щоб структура кабінету була видна
defineProps<{ title: string }>()
</script>

<template lang="pug">
main.page
  .page-head
    h1.page-head__title {{ title }}
  .card.soon
    p.soon__text Цей розділ зʼявиться найближчим часом.
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.soon {
  padding: 48px 24px;
  text-align: center;

  &__text {
    color: $text-muted;
  }
}
</style>
