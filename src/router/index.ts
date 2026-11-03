import { createRouter, createWebHistory } from 'vue-router'

// Маршрути клієнта (/c/…) і нутриціолога (/n/…) з'являться на 3-й день
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
