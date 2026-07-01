import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../store/auth";

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    roles?: string[]
  }
}


const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },

        { path: '/', name: 'pos', component: () => import('../views/POSView.vue'), meta: { requiresAuth: true, roles: ['admin', 'manager', 'cashier'] } },

        { path: '/users', name: 'users', component: () => import('../views/UserManagementView.vue'), meta: { requiresAuth: true, roles: ['admin'] } },

        { path: '/add-new', name: 'add-new', component: () => import('../views/AddNewView.vue'), meta: { requiresAuth: true, roles: ['admin', 'manager'] } },

        { path: '/product-list', name: 'product-list', component: () => import('../views/ProductListView.vue'), meta: { requiresAuth: true, roles: ['admin', 'manager'] } },

        { path: '/today-business', name: 'today-business', component: () => import('../views/TodayBusinessView.vue'), meta: { requiresAuth: true, roles: ['admin', 'manager'] } },

        { path: '/barcode-print', name: 'barcode-print', component: () => import('../views/BarcodePrint.vue'), meta: { requiresAuth: true, roles: ['admin', 'manager'] } },

        { path: '/owner-earnings', name: 'owner-earnings', component: () => import('../views/OwnerEarningsView.vue'), meta: { requiresAuth: true, roles: ['admin'] } },

        { path: '/pay-later', name: 'pay-later', component: () => import('../views/PayLaterView.vue'), meta: { requiresAuth: true, roles: ['admin', 'manager'] } },
    ]
})

let authInitialized = false

// Security guard — runs before every page loads
router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // Initialize auth only ONCE when app first loads
  if (!authInitialized) {
    await auth.init()
    authInitialized = true
  }

  // If page requires login and not logged in → go to login
  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: 'login' }
  }

  // If logged in and trying to go to login page → go home
  if (to.name === 'login' && auth.isLoggedIn) {
    return { name: 'pos' }
  }

  // If page has role restriction → check role (only if profile is loaded)
  if (to.meta.roles && auth.isLoggedIn && auth.profile) {
    if (!to.meta.roles.includes(auth.userRole)) {
      return { name: 'login' } // not allowed → back to login
    }
  }
})

export default router