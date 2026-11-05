import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    role?: 'client' | 'nutri'
  }
}

const SoonView = () => import('@/views/SoonView.vue')
const RecipesView = () => import('@/views/RecipesView.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Головна веде в кабінет своєї ролі (див. beforeEach)
    { path: '/', name: 'home', component: SoonView },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/c',
      component: () => import('@/layouts/ClientLayout.vue'),
      meta: { role: 'client' },
      children: [
        { path: '', name: 'client-today', component: () => import('@/views/client/TodayView.vue') },
        { path: 'menu', name: 'client-menu', component: () => import('@/views/client/MenuView.vue') },
        { path: 'diary', name: 'client-diary', component: () => import('@/views/client/DiaryView.vue') },
        { path: 'shop', name: 'client-shop', component: () => import('@/views/client/ShopView.vue') },
        { path: 'recipes/:id?', name: 'client-recipes', component: RecipesView },
        { path: 'tests', name: 'client-tests', component: () => import('@/views/client/TestsView.vue') },
        { path: 'chat', name: 'client-chat', component: () => import('@/views/client/ChatView.vue') },
      ],
    },
    {
      path: '/n',
      component: () => import('@/layouts/NutriLayout.vue'),
      meta: { role: 'nutri' },
      children: [
        { path: '', name: 'nutri-overview', component: () => import('@/views/nutri/OverviewView.vue') },
        { path: 'clients/:id?', name: 'nutri-clients', component: () => import('@/views/nutri/ClientsView.vue') },
        { path: 'diaries', name: 'nutri-diaries', component: () => import('@/views/nutri/DiariesView.vue') },
        { path: 'calendar', name: 'nutri-calendar', component: () => import('@/views/nutri/CalendarView.vue') },
        { path: 'builder', name: 'nutri-builder', component: () => import('@/views/nutri/BuilderView.vue') },
        { path: 'recipes/:id?', name: 'nutri-recipes', component: RecipesView },
        { path: 'payments', name: 'nutri-payments', component: () => import('@/views/nutri/PaymentsView.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuth()
  await auth.init()
  const account = auth.account

  if (!to.meta.public && !account) return { name: 'login', query: { next: to.fullPath } }
  if (!account) return

  const home = account.role === 'nutri' ? '/n' : '/c'
  if (to.name === 'login' || to.name === 'home') return home
  // Клієнт не відкриває сторінки нутриціолога і навпаки
  if (to.meta.role && to.meta.role !== account.role) return home
})

export default router
