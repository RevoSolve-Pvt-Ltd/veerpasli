import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'DonationList',
    component: () => import('@/pages/DonationList.vue'),
  },
  {
    path: '/create',
    name: 'DonationCreate',
    component: () => import('@/pages/DonationCreate.vue'),
  },
  {
    path: '/receipt/:name',
    name: 'DonationReceipt',
    component: () => import('@/pages/DonationReceipt.vue'),
  },
]

let router = createRouter({
  history: createWebHistory('/donation'),
  routes,
})

export default router
