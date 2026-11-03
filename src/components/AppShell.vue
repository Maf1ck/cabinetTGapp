<script setup lang="ts">
// Оболонка кабінету: бокова навігація на широкому екрані, нижня панель + «Ще» на телефоні.
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon, { type IconName } from './AppIcon.vue'
import { useAuth } from '@/stores/auth'
import { telegramApp } from '@/lib/telegram'

export interface NavItem {
  to: string
  label: string
  short?: string
  icon: IconName
}

const props = defineProps<{
  variant: 'client' | 'nutri'
  title: string
  subtitle?: string
  items: NavItem[]
  // скільки пунктів поміщається в нижню панель на телефоні, решта йде в «Ще»
  primary: number
}>()

const auth = useAuth()
const route = useRoute()
const router = useRouter()
const inTelegram = telegramApp() !== null
const moreOpen = ref(false)

const bottomItems = computed(() => props.items.slice(0, props.primary))
const moreItems = computed(() => props.items.slice(props.primary))
const moreActive = computed(() => moreItems.value.some((i) => isActive(i)))

// Головна (/c, /n) активна лише сама; решта і для вкладених адрес (/n/clients/…)
const home = computed(() => props.items[0]?.to)
function isActive(item: NavItem): boolean {
  return item.to === home.value ? route.path === item.to : route.path.startsWith(item.to)
}

watch(
  () => route.fullPath,
  () => (moreOpen.value = false),
)

async function logout() {
  await auth.logout()
  router.replace({ name: 'login' })
}
</script>

<template lang="pug">
.shell(:class='`shell--${variant}`')
  aside.shell__side
    .shell__brand
      AppIcon(v-if='variant === "client"' name='leaf' :size='26')
      div
        .shell__title {{ title }}
        .shell__subtitle(v-if='subtitle') {{ subtitle }}
    nav.shell__nav(aria-label='Розділи')
      RouterLink.shell__link(
        v-for='item in items'
        :key='item.to'
        :to='item.to'
        :class='{ "shell__link--active": isActive(item) }'
        :aria-current='isActive(item) ? "page" : undefined'
      )
        AppIcon(:name='item.icon' :size='20')
        | {{ item.label }}
    button.shell__link.shell__logout(v-if='!inTelegram' type='button' @click='logout')
      AppIcon(name='logout' :size='20')
      | Вийти

  .shell__main
    RouterView

  nav.shell__tabs(aria-label='Розділи')
    RouterLink.shell__tab(
      v-for='item in bottomItems'
      :key='item.to'
      :to='item.to'
      :class='{ "shell__tab--active": isActive(item) }'
      :aria-current='isActive(item) ? "page" : undefined'
    )
      AppIcon(:name='item.icon')
      span {{ item.short ?? item.label }}
    button.shell__tab(type='button' :class='{ "shell__tab--active": moreActive }' :aria-expanded='moreOpen' @click='moreOpen = !moreOpen')
      AppIcon(name='more')
      span Ще

  Transition(name='shell-sheet')
    .shell__sheet(v-if='moreOpen' @click.self='moreOpen = false')
      .shell__sheet-body(role='dialog' aria-label='Інші розділи')
        RouterLink.shell__sheet-link(v-for='item in moreItems' :key='item.to' :to='item.to')
          AppIcon(:name='item.icon')
          | {{ item.label }}
        button.shell__sheet-link(v-if='!inTelegram' type='button' @click='logout')
          AppIcon(name='logout')
          | Вийти
</template>

<style lang="scss">
@use '@/scss/variables' as *;

$tabs-h: 64px;

.shell {
  display: flex;
  min-height: 100vh;
  min-height: 100dvh;

  &__side {
    position: sticky;
    top: 0;
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 26px;
    width: 248px;
    height: 100vh;
    padding: 24px 18px;
    overflow-y: auto;
    background: $bg;
    border-right: 1px solid $line;

    @media (max-width: $bp-sidebar) {
      display: none;
    }
  }

  &__brand {
    display: flex;
    align-items: center;
    gap: 10px;
    color: $accent;
  }

  &__title {
    color: $text;
    font-family: $font-heading;
    font-size: 19px;
    font-weight: 600;
    line-height: 1.25;
  }

  &__subtitle {
    font-size: 13px;
  }

  &__nav {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__link {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border: 0;
    border-radius: 12px;
    background: none;
    color: $text-nav;
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.15s ease;

    &:hover {
      background: $bg-soft;
      color: $text-nav;
    }

    &--active,
    &--active:hover {
      background: $bg-active;
      color: $text-active;
      font-weight: 700;
    }
  }

  &__logout {
    margin-top: auto;
  }

  &__main {
    flex: 1;
    min-width: 0;
    display: flex;
    justify-content: center;

    @media (max-width: $bp-sidebar) {
      padding-bottom: calc(#{$tabs-h} + env(safe-area-inset-bottom));
    }
  }

  // ---------- телефон: нижня панель ----------
  &__tabs {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 20;
    display: none;
    height: calc(#{$tabs-h} + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    border-top: 1px solid $line;
    background: rgba(255, 255, 255, 0.96);
    backdrop-filter: blur(8px);

    @media (max-width: $bp-sidebar) {
      display: flex;
    }
  }

  &__tab {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-width: 0;
    border: 0;
    background: none;
    color: $text-faint;
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;

    span {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &:hover {
      color: $text-nav;
    }

    &--active,
    &--active:hover {
      color: $accent;
    }
  }

  &__sheet {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: flex-end;
    background: rgba(20, 38, 27, 0.35);
  }

  &__sheet-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: 14px 14px calc(14px + #{$tabs-h} + env(safe-area-inset-bottom));
    border-radius: $radius-card $radius-card 0 0;
    background: $bg;
  }

  &__sheet-link {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 0 14px;
    border: 0;
    border-radius: 12px;
    background: none;
    color: $text;
    font: inherit;
    font-weight: 600;
    text-align: left;
    text-decoration: none;
    cursor: pointer;

    &:hover,
    &.router-link-active {
      background: $bg-active;
      color: $text-active;
    }
  }

  // ---------- нутриціолог: темна панель ----------
  &--nutri &__side {
    border-right: 0;
    background: $green-dark;
    color: #fff;
  }

  &--nutri &__title {
    color: #fff;
    font-size: 20px;
  }

  &--nutri &__subtitle {
    color: $nutri-sub;
  }

  &--nutri &__link {
    color: $text-on-dark;

    &:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }

    &--active,
    &--active:hover {
      background: $nutri-active;
      color: #fff;
    }
  }
}

.shell-sheet-enter-active,
.shell-sheet-leave-active {
  transition: opacity 0.2s ease;

  .shell__sheet-body {
    transition: transform 0.2s ease;
  }
}

.shell-sheet-enter-from,
.shell-sheet-leave-to {
  opacity: 0;

  .shell__sheet-body {
    transform: translateY(24px);
  }
}
</style>
