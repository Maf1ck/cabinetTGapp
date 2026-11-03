<script setup lang="ts">
import AppShell, { type NavItem } from '@/components/AppShell.vue'

const items: NavItem[] = [
  { to: '/c', label: 'Сьогодні', icon: 'sun' },
  { to: '/c/menu', label: 'Моє меню', short: 'Меню', icon: 'menu' },
  { to: '/c/diary', label: 'Щоденник їжі', short: 'Щоденник', icon: 'camera' },
  { to: '/c/shop', label: 'Список покупок', short: 'Покупки', icon: 'cart' },
  { to: '/c/recipes', label: 'Рецепти', icon: 'book' },
  { to: '/c/tests', label: 'Мої аналізи', icon: 'flask' },
  { to: '/c/chat', label: 'Чат з нутриціологом', icon: 'chat' },
]
</script>

<template lang="pug">
AppShell(variant='client' title='Мій кабінет' :items='items' :primary='4')
</template>
