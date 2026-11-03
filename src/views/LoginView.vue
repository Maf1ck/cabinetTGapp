<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import { telegramApp } from '@/lib/telegram'

const CONTACT_URL = 'https://t.me/nk_1802'

const auth = useAuth()
const router = useRouter()
const route = useRoute()
const inTelegram = telegramApp() !== null

const errorText = computed(
  () =>
    ({
      no_access: 'Кабінет доступний лише клієнтам Анастасії за запрошенням.',
      expired: 'Час на підтвердження вийшов. Спробуйте ще раз.',
      network: 'Не вдалося зʼєднатися із сервером. Перевірте інтернет і спробуйте ще раз.',
    })[auth.error ?? 'network'],
)

watch(
  () => auth.account,
  (account) => {
    if (!account) return
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/'
    router.replace(next)
  },
)

const reload = () => window.location.reload()

onBeforeUnmount(() => auth.stopPolling())
</script>

<template lang="pug">
main.login
  .login__card
    svg.login__logo(width='40' height='40' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true')
      path(d='M5 19c0-8 5-13 14-14-1 9-6 14-14 14z')
      path(d='M5 19l7-7')
    h1.login__title Кабінет
    p.login__text Меню, щоденник харчування і звʼязок з нутриціологом Анастасією.

    p.login__error(v-if='auth.error' role='alert') {{ errorText }}

    template(v-if='inTelegram')
      a.login__btn(v-if='auth.error === "no_access"' :href='CONTACT_URL') Написати Анастасії
      button.login__btn(v-else type='button' @click='reload') Спробувати ще раз

    template(v-else-if='auth.waitingBot')
      p.login__wait
        span.login__spinner(aria-hidden='true')
        | Натисніть «Так, це я, увійти» у боті. Сторінка оновиться сама.
      a.login__link(v-if='auth.botUrl' :href='auth.botUrl' target='_blank' rel='noopener') Відкрити бота ще раз
      button.login__link(type='button' @click='auth.stopPolling()') Скасувати

    template(v-else)
      button.login__btn(type='button' @click='auth.startBrowserLogin()')
        svg(width='20' height='20' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true')
          path(d='M21.9 4.6 18.7 19.7c-.2 1-.9 1.3-1.7.8l-4.9-3.6-2.3 2.2c-.3.3-.5.5-1 .5l.3-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.3 13.3l-4.8-1.5c-1-.3-1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.6z')
        | Увійти через Telegram
      p.login__hint(v-if='auth.error === "no_access"')
        | Немає запрошення?
        |
        a(:href='CONTACT_URL' target='_blank' rel='noopener') Напишіть Анастасії
      p.login__hint(v-else) Без паролів: підтвердження приходить від бота в Telegram.
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.login {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 24px 16px;

  &__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: 100%;
    max-width: 400px;
    padding: 40px 28px;
    border: 1px solid $line;
    border-radius: $radius-card;
    background: $bg;
    text-align: center;
  }

  &__logo {
    color: $accent;
  }

  &__title {
    color: $text-heading;
    font-size: 32px;
  }

  &__text {
    color: $text-muted;
  }

  &__error {
    width: 100%;
    padding: 12px 14px;
    border-radius: $radius-item;
    background: #fdf3e1;
    color: $text-warn;
    font-size: 14px;
  }

  &__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    margin-top: 8px;
    padding: 15px 22px;
    border: 0;
    border-radius: $pill;
    background: $accent;
    color: #fff;
    font: inherit;
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.2s ease;

    &:hover {
      background: $green-dark;
      color: #fff;
    }

    &:focus-visible {
      outline: 3px solid $line-green;
      outline-offset: 2px;
    }
  }

  &__hint {
    color: $text-muted;
    font-size: 13px;
  }

  &__wait {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px;
    border-radius: $radius-item;
    background: $bg-soft;
    text-align: left;
  }

  &__spinner {
    flex: none;
    width: 22px;
    height: 22px;
    border: 3px solid $line-green;
    border-top-color: $accent;
    border-radius: 50%;
    animation: login-spin 0.9s linear infinite;
  }

  &__link {
    padding: 0;
    border: 0;
    background: none;
    color: $green-link;
    font: inherit;
    font-size: 14px;
    text-decoration: underline;
    cursor: pointer;
  }
}

@keyframes login-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .login__spinner {
    animation-duration: 3s;
  }
}
</style>
