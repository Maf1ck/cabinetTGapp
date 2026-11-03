<template lang="pug">
main.home
  h1.home__title Кабінет
  p.home__text Скоро тут буде вхід через Telegram.
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.home {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 100vh;
  padding: 24px;
  text-align: center;

  &__title {
    font-size: 36px;
  }

  &__text {
    color: $text-muted;
  }
}
</style>
