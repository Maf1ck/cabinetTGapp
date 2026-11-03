<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import { telegramApp } from '@/lib/telegram'

// Тимчасова сторінка: на 3-й день тут будуть екрани клієнта й нутриціолога
const auth = useAuth()
const router = useRouter()
const inTelegram = telegramApp() !== null

function logout() {
  auth.logout()
  router.replace({ name: 'login' })
}
</script>

<template lang="pug">
main.home
  h1.home__title Вітаю{{ auth.account?.firstName ? `, ${auth.account.firstName}` : '' }}!
  p.home__text {{ auth.isNutri ? 'Ви увійшли як нутриціолог.' : 'Ви увійшли у свій кабінет.' }}
  button.home__logout(v-if='!inTelegram' type='button' @click='logout') Вийти
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

  &__logout {
    margin-top: 12px;
    padding: 10px 20px;
    border: 1px solid $line-input;
    border-radius: $pill;
    background: $bg;
    color: $text;
    font: inherit;
    cursor: pointer;
  }
}
</style>
