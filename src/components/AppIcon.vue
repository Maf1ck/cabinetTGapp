<script setup lang="ts">
// Іконки в стилі Lucide (stroke 2), лише ті, що потрібні кабінету
const PATHS = {
  sun: ['M12 3v2', 'M12 19v2', 'M5 5l1.5 1.5', 'M17.5 17.5L19 19', 'M3 12h2', 'M19 12h2', 'M5 19l1.5-1.5', 'M17.5 6.5L19 5', 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z'],
  menu: ['M4 5h16v15H4z', 'M4 10h16', 'M9 3v4', 'M15 3v4'],
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z'],
  cart: ['M3 4h2l2.5 11h10L20 7H6.5', 'M9 20a1 1 0 1 0 0-2a1 1 0 0 0 0 2z', 'M17 20a1 1 0 1 0 0-2a1 1 0 0 0 0 2z'],
  book: ['M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z', 'M5 17a3 3 0 0 1 3-3h11'],
  flask: ['M9 3h6', 'M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3', 'M7.5 14h9'],
  chat: ['M4 5h16v11H9l-5 4z'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  home: ['M4 11l8-7 8 7v9H4z', 'M10 20v-5h4v5'],
  calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  users: ['M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8z', 'M2 21a7 7 0 0 1 14 0', 'M16 3.5a4 4 0 0 1 0 7', 'M22 21a7 7 0 0 0-4-6.3'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  wallet: ['M4 7h15a1 1 0 0 1 1 1v11H4z', 'M4 7l11-3v3', 'M16 13h.01'],
  logout: ['M10 4H5v16h5', 'M15 8l4 4-4 4', 'M19 12H9'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  flame: ['M12 3c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-5 1-8z'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  check: ['M5 12l5 5L20 7'],
  chevronLeft: ['M15 6l-6 6 6 6'],
  chevronRight: ['M9 6l6 6-6 6'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  leaf: ['M5 19c0-8 5-13 14-14-1 9-6 14-14 14z', 'M5 19l7-7'],
  bulb: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z'],
} as const

export type IconName = keyof typeof PATHS

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 22 })
const paths = PATHS[props.name]
</script>

<template lang="pug">
svg.icon(:width='size' :height='size' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true')
  path(v-for='d in paths' :key='d' :d='d')
</template>

<style lang="scss">
.icon {
  flex: none;
}
</style>
