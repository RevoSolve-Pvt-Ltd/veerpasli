<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Initial Loading State -->
    <div v-if="initialLoading" class="flex items-center justify-center min-h-screen">
      <div class="text-center">
        <LoadingIndicator class="w-8 h-8 text-blue-600 mx-auto mb-3" />
        <p class="text-gray-500 text-sm">Loading dashboard…</p>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex items-center justify-center min-h-screen p-4">
      <div class="bg-white rounded-xl shadow-sm border border-red-100 p-8 max-w-md w-full text-center">
        <div class="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <FeatherIcon name="alert-triangle" class="w-6 h-6 text-red-500" />
        </div>
        <h3 class="font-semibold text-gray-800 mb-2">Error</h3>
        <p class="text-gray-500 text-sm mb-4">{{ error }}</p>
        <Button appearance="primary" @click="goToLogin()">
          Log in as Collector
        </Button>
      </div>
    </div>

    <!-- Main Dashboard -->
    <div v-else class="max-w-5xl mx-auto px-4 py-8">

      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">
            Collector Dashboard
          </p>
          <h1 class="text-2xl font-bold text-gray-900 leading-tight">
            {{ collector.gujarati_fullname }}
          </h1>
          <p class="text-base text-gray-500 font-medium">
            ({{ collector.english_fullname }})
          </p>
        </div>
        <div class="flex items-center gap-3">
          <Button
            appearance="white"
            icon-left="log-out"
            @click="handleLogout"
          >
            Logout
          </Button>
          <Button
            appearance="primary"
            icon-left="plus"
            @click="$router.push('/create')"
          >
            Create New Donation
          </Button>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="grid grid-cols-2 gap-4 mb-8">
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Total Collected
          </p>
          <p class="text-2xl font-bold text-gray-900">
            ₹{{ totalAmount.toLocaleString('en-IN') }}
          </p>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Total Donors
          </p>
          <p class="text-2xl font-bold text-gray-900">{{ totalDonors }}</p>
        </div>
      </div>

      <!-- Donations List Card -->
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden relative">
        
        <!-- Table Loading Overlay -->
        <div
          v-if="tableLoading"
          class="absolute inset-0 bg-white/70 backdrop-blur-[2px] flex items-center justify-center z-10"
        >
          <div class="text-center">
            <LoadingIndicator class="w-8 h-8 text-blue-600 mx-auto mb-2" />
            <p class="text-gray-500 text-sm font-medium">Searching donations…</p>
          </div>
        </div>

        <!-- Card Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <h2 class="font-semibold text-gray-800 flex items-center gap-2">
            <FeatherIcon name="list" class="w-4 h-4 text-blue-500" />
            Recent Donations
          </h2>
          <Input
            :value="searchQuery"
            @input="(v) => { searchQuery = v }"
            placeholder="Search by donor name…"
            icon-left="search"
            class="max-w-xs"
          />
        </div>

        <!-- Empty State -->
        <div v-if="filteredDonations.length === 0" class="text-center py-16 px-4">
          <div class="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <FeatherIcon name="heart" class="w-8 h-8 text-blue-400" />
          </div>
          <h3 class="font-semibold text-gray-700 mb-1">
            {{ searchQuery ? 'No matching donations' : 'No donations yet' }}
          </h3>
          <p class="text-gray-400 text-sm">
            {{ searchQuery ? 'Try a different search term.' : 'Tap "Create New Donation" to log your first one!' }}
          </p>
        </div>

        <!-- Table -->
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 border-b border-gray-100">
              <tr>
                <th class="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Donor (દાતા)
                </th>
                <th class="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Amount (રકમ)
                </th>
                <th class="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden sm:table-cell">
                  Village (ગામ)
                </th>
                <th class="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">
                  Date
                </th>
                <th class="text-center px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Receipt
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="d in paginatedDonations"
                :key="d.name"
                class="border-b border-gray-50 hover:bg-gray-50 transition-colors"
              >
                <td class="px-5 py-4">
                  <p class="font-semibold text-gray-800">{{ d.donor_gujarati }}</p>
                  <p v-if="d.donor_english" class="text-xs text-gray-400">{{ d.donor_english }}</p>
                </td>
                <td class="px-5 py-4 text-right">
                  <span class="font-bold text-green-600">₹{{ d.amount_english }}</span>
                </td>
                <td class="px-5 py-4 hidden sm:table-cell text-gray-600">
                  {{ d.village }}
                </td>
                <td class="px-5 py-4 hidden md:table-cell text-gray-400 text-xs">
                  {{ d.donation_date }}
                </td>
                <td class="px-5 py-4 text-center">
                  <Button
                    appearance="white"
                    icon-left="eye"
                    @click="$router.push('/receipt/' + d.name)"
                  >
                    View
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- Pagination -->
          <div
            v-if="totalCount > 0"
            class="flex items-center justify-between px-5 py-3 border-t border-gray-100"
          >
            <Button
              icon-left="chevron-left"
              :disabled="currentPage === 1"
              @click="currentPage--"
            >
              Prev
            </Button>
            <span class="text-xs text-gray-400 font-medium">
              Page {{ currentPage }} of {{ totalPages }}
            </span>
            <Button
              icon-right="chevron-right"
              :disabled="currentPage === totalPages"
              @click="currentPage++"
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { Button, Input, FeatherIcon, LoadingIndicator } from 'frappe-ui'
import { getDonationsDashboard, getLoginUrl, logout } from '@/utils/api'

export default {
  name: 'DonationsList',
  components: { Button, Input, FeatherIcon, LoadingIndicator },

  data() {
    return {
      initialLoading: true,
      tableLoading: false,
      error: null,
      collector: {},
      donations: [],
      searchQuery: '',
      currentPage: 1,
      rowsPerPage: 10,
      totalCount: 0,
      totalAmount: 0,
      totalDonors: 0,
    }
  },

  computed: {
    filteredDonations() {
      return this.donations
    },
    totalPages() {
      return Math.ceil(this.totalCount / this.rowsPerPage) || 1
    },
    paginatedDonations() {
      return this.donations
    },
  },

  watch: {
    currentPage() {
      this.fetchDonations(false)
    },
    searchQuery() {
      this.currentPage = 1
      clearTimeout(this._searchTimer)
      this._searchTimer = setTimeout(() => {
        this.fetchDonations(false)
      }, 300)
    },
  },

  created() {
    this.fetchDonations(true)
  },

  methods: {
    async fetchDonations(isInitial = false) {
      if (isInitial) {
        this.initialLoading = true
      } else {
        this.tableLoading = true
      }
      try {
        const data = await getDonationsDashboard({
          page: this.currentPage,
          page_size: this.rowsPerPage,
          search: this.searchQuery,
        })
        this.collector = data.collector || {}
        this.donations = data.donations || []
        this.totalCount = data.total || 0
        this.totalAmount = data.total_collected_amount || 0
        this.totalDonors = data.total_donors || 0
      } catch (err) {
        if (err.exc_type === 'PermissionError' || (err.message && err.message.includes('Login to access'))) {
          window.location.href = getLoginUrl('/donation')
          return
        }
        let msg = err.message || 'Failed to fetch donations. Please check your connection.'
        if (msg.includes('/api/method/')) {
          msg = msg.replace(/^\/api\/method\/[a-zA-Z0-9_\.]+\s+/, '')
        }
        msg = msg.replace(/<\/?[^>]+(>|$)/g, "")
        this.error = msg
      } finally {
        this.initialLoading = false
        this.tableLoading = false
      }
    },
    goToLogin() {
      window.location.href = getLoginUrl('/donation')
    },
    async handleLogout() {
      try {
        await logout()
      } catch (err) {
        // Fallback redirection even if the API call fails
      }
      window.location.href = getLoginUrl('/donation')
    }
  }
}
</script>
