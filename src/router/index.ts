import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/stores/auth'

// Маршрути клієнта (/c/…) і нутриціолога (/n/…) з'являться на 3-й день
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuth()
  await auth.init()
  if (!to.meta.public && !auth.account) return { name: 'login', query: { next: to.fullPath } }
  if (to.name === 'login' && auth.account) return { name: 'home' }
})

export default router
