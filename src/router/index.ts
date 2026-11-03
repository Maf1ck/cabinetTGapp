import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuth } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    role?: 'client' | 'nutri'
  }
}

const SoonView = () => import('@/views/SoonView.vue')
const soon = (path: string, title: string): RouteRecordRaw => ({
  path,
  component: SoonView,
  props: { title },
})

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
        soon('diary', 'Щоденник їжі'),
        soon('shop', 'Список покупок'),
        soon('recipes', 'Рецепти'),
        soon('tests', 'Мої аналізи'),
        soon('chat', 'Чат з нутриціологом'),
      ],
    },
    {
      path: '/n',
      component: () => import('@/layouts/NutriLayout.vue'),
      meta: { role: 'nutri' },
      children: [
        { path: '', name: 'nutri-overview', component: () => import('@/views/nutri/OverviewView.vue') },
        { path: 'clients/:id?', name: 'nutri-clients', component: () => import('@/views/nutri/ClientsView.vue') },
        soon('diaries', 'Щоденники'),
        soon('calendar', 'Календар'),
        soon('builder', 'Конструктор меню'),
        soon('recipes', 'База рецептів'),
        soon('payments', 'Оплати'),
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
