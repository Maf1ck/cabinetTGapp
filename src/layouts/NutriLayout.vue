<script setup lang="ts">
import AppShell, { type NavItem } from '@/components/AppShell.vue'
import { useAuth } from '@/stores/auth'

const auth = useAuth()

const items: NavItem[] = [
  { to: '/n', label: 'Огляд', icon: 'home' },
  { to: '/n/clients', label: 'Клієнти', icon: 'users' },
  { to: '/n/diaries', label: 'Щоденники', icon: 'camera' },
  { to: '/n/calendar', label: 'Календар', icon: 'calendar' },
  { to: '/n/builder', label: 'Конструктор меню', icon: 'grid' },
  { to: '/n/recipes', label: 'База рецептів', icon: 'book' },
  { to: '/n/payments', label: 'Оплати', icon: 'wallet' },
]
</script>

<template lang="pug">
AppShell(
  variant='nutri'
  :title='`${auth.account?.firstName ?? "Анастасія"} · нутриціолог`'
  subtitle='Робочий кабінет'
  :items='items'
  :primary='4'
)
</template>
