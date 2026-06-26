<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Loading State -->
    <div v-if="loading" class="flex items-center justify-center min-h-screen">
      <div class="text-center">
        <LoadingIndicator class="w-8 h-8 text-blue-600 mx-auto mb-3" />
        <p class="text-gray-500 text-sm">Loading form…</p>
      </div>
    </div>

    <!-- Error / Unauthorized -->
    <div v-else-if="contextError" class="flex items-center justify-center min-h-screen p-4">
      <div class="bg-white rounded-xl shadow-sm border border-red-100 p-8 max-w-md w-full text-center">
        <div class="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <FeatherIcon name="lock" class="w-6 h-6 text-red-500" />
        </div>
        <h3 class="font-semibold text-gray-800 mb-2">Access Denied</h3>
        <p class="text-gray-500 text-sm mb-4">{{ contextError }}</p>
        <Button appearance="primary" @click="$router.push('/')">Go to Dashboard</Button>
      </div>
    </div>

    <!-- Main Form -->
    <div v-else class="max-w-2xl mx-auto px-4 py-8">

      <!-- Page Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">
            Create Donation
          </p>
          <h1 class="text-xl font-bold text-gray-900">New Donation Entry</h1>
        </div>
        <Button icon-left="arrow-left" @click="$router.push('/')">Dashboard</Button>
      </div>

      <!-- Form Card -->
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">

        <!-- Collector Field (Disabled) -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1.5">
            Collector / સંગ્રહકર્તા
          </label>
          <Input
            :value="collector.gujarati_fullname + ' (' + collector.english_fullname + ')'"
            disabled
          />
        </div>

        <div class="border-t border-gray-100" />

        <!-- Success Alert -->
        <Alert v-if="successMsg" :title="successMsg.title">
          <Button
            appearance="success"
            icon-left="file-text"
            @click="$router.push('/receipt/' + successMsg.donationId)"
          >
            View Receipt
          </Button>
        </Alert>

        <!-- Error Alert -->
        <Alert v-if="formError" :title="formError" />

        <!-- ── Donor Search ───────────────────────────────── -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1.5">
            <FeatherIcon name="search" class="w-3.5 h-3.5 inline mr-1 text-gray-400" />
            Search Existing Donor
          </label>
          <div class="relative">
            <Input
              :value="donorSearchText"
              placeholder="Type name or mobile to lookup…"
              @input="(v) => { donorSearchText = v; onDonorInput() }"
              @change="(v) => { donorSearchText = v; onDonorInput() }"
            />
            <!-- Dropdown Results -->
            <div
              v-if="donorResults.length > 0"
              class="absolute z-50 w-full mt-1 bg-white rounded-lg border border-gray-200 shadow-lg max-h-60 overflow-y-auto"
            >
              <button
                v-for="d in donorResults"
                :key="d.name"
                class="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                @click="selectDonor(d)"
              >
                <p class="font-semibold text-gray-800">
                  {{ d.gujarati_fullname }}
                  <span class="font-normal text-gray-500">({{ d.english_fullname || '' }})</span>
                </p>
                <p class="text-xs text-gray-400">
                  {{ d.mobile_number || 'No mobile' }} · {{ d.village_gujarati_name || '' }}
                </p>
              </button>
            </div>
          </div>
          <p class="text-xs text-gray-400 mt-1">
            Selecting a donor auto-fills their name, mobile, and village.
          </p>
        </div>

        <div class="border-t border-gray-100" />

        <!-- ── Date ─────────────────────────────────────── -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1.5">
            Donation Date <span class="text-red-500">*</span>
          </label>
          <Input v-model="form.donation_date" type="date" required />
        </div>

        <!-- ── Donor Names ────────────────────────────── -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1.5">
              Donor Gujarati Name <span class="text-red-500">*</span>
            </label>
            <Input
              :value="form.donor_name_guj"
              placeholder="દાતાનું નામ (ગુજરાતીમાં)"
              @input="(v) => { form.donor_name_guj = v; onGujInput() }"
              @change="(v) => { form.donor_name_guj = v; onGujInput() }"
              required
            />
          </div>

          <div class="relative">
            <label class="block text-sm font-semibold text-gray-700 mb-1.5">
              Donor English Name
            </label>
            <Input
              :value="form.donor_name_eng"
              placeholder="Donor Name (English)"
              @input="(v) => { form.donor_name_eng = v; onEngInput() }"
              @change="(v) => { form.donor_name_eng = v; onEngInput() }"
            />
            <!-- Translation Suggestions -->
            <div
              v-if="translationSuggestions.length > 0"
              class="absolute z-50 w-full mt-1 bg-white rounded-lg border border-gray-200 shadow-lg"
            >
              <button
                v-for="(opt, i) in translationSuggestions"
                :key="i"
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                @click="selectTranslation(opt)"
              >
                <strong>{{ opt }}</strong>
              </button>
            </div>
          </div>
        </div>

        <!-- ── Mobile & Village ──────────────────────── -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1.5">
              Mobile Number
            </label>
            <Input
              v-model="form.mobile"
              placeholder="10-digit Mobile Number"
            />
          </div>
          <div class="relative" id="village-container">
            <label class="block text-sm font-semibold text-gray-700 mb-1.5">
              Village <span class="text-red-500">*</span>
            </label>
            <Input
              :value="form.village"
              placeholder="Search or type village name…"
              @input="(v) => { form.village = v; showVillageDropdown = true }"
              @change="(v) => { form.village = v; showVillageDropdown = true }"
              @focus="showVillageDropdown = true"
            />
            <!-- Dropdown Options -->
            <div
              v-if="showVillageDropdown && filteredVillagesList.length > 0"
              class="absolute z-50 w-full mt-1 bg-white rounded-lg border border-gray-200 shadow-lg max-h-60 overflow-y-auto"
            >
              <button
                v-for="v in filteredVillagesList"
                :key="v.name"
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex flex-col border-b border-gray-50 last:border-0"
                @click="selectVillage(v)"
              >
                <span class="font-semibold text-gray-800">{{ v.name }}</span>
                <span v-if="v.english_name" class="text-xs text-gray-500">{{ v.english_name }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- ── Amount & Location ───────────────────── -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1.5">
              Donation Amount (INR) <span class="text-red-500">*</span>
            </label>
            <div class="relative">
              <span
                class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm select-none pointer-events-none"
              >₹</span>
              <Input
                v-model="form.amount"
                type="number"
                placeholder="e.g. 500"
                min="1"
                required
                class="pl-7"
              />
            </div>
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1.5">
              Location <span class="text-red-500">*</span>
            </label>
            <Input
              v-model="form.location"
              type="select"
              :options="locationSelectOptions"
            />
          </div>
        </div>

        <!-- ── Hastes Section ─────────────────────── -->
        <div class="bg-gray-50 rounded-xl border border-gray-100 p-4">
          <div class="flex items-center justify-between mb-3">
            <p class="text-sm font-semibold text-gray-600 flex items-center gap-2">
              <FeatherIcon name="users" class="w-4 h-4" />
              Haste / Through (હસ્તે)
            </p>
            <Button icon-left="plus" @click="addHaste">Add Haste</Button>
          </div>

          <div
            v-for="(haste, idx) in hastes"
            :key="haste.id"
            class="flex items-start gap-2 mb-2"
          >
            <div class="flex-1 relative">
              <Input
                :value="haste.displayText"
                placeholder="Enter Haste Name (હસ્તે નામ)"
                @change="(v) => { haste.displayText = v; onHasteInput(idx) }"
                @input="(v) => { haste.displayText = v; onHasteInput(idx) }"
              />
              <div
                v-if="haste.searchResults && haste.searchResults.length > 0"
                class="absolute z-50 w-full mt-1 bg-white rounded-lg border border-gray-200 shadow-lg max-h-48 overflow-y-auto"
              >
                <button
                  v-for="d in haste.searchResults"
                  :key="d.name"
                  class="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                  @click="selectHastePerson(d, idx)"
                >
                  <span class="font-medium">{{ d.gujarati_fullname }}</span>
                  <span class="text-gray-400 ml-1">({{ d.english_fullname || '' }}) — {{ d.village_gujarati_name || '' }}</span>
                </button>
              </div>
            </div>
            <button
              class="mt-0.5 p-2 rounded-md text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
              @click="removeHaste(idx)"
            >
              <FeatherIcon name="trash-2" class="w-4 h-4" />
            </button>
          </div>

          <p class="text-xs text-gray-400 mt-2">
            If Hastes are added, the total amount will be split equally among them.
          </p>
        </div>

        <!-- ── Submit ──────────────────────────────── -->
        <div class="flex justify-end pt-2">
          <Button
            appearance="primary"
            icon-left="check-circle"
            :loading="submitting"
            @click="submitForm"
          >
            Save Donation
          </Button>
        </div>

      </div>
    </div>
  </div>
</template>

<script>
import { Button, Input, Autocomplete, FeatherIcon, LoadingIndicator, Alert } from 'frappe-ui'
import { getFormContext, searchDonor, getTranslation, createWebDonation, getLoginUrl } from '@/utils/api'

export default {
  name: 'DonationCreate',

  components: { Button, Input, Autocomplete, FeatherIcon, LoadingIndicator, Alert },

  data() {
    return {
      loading: true,
      contextError: null,
      submitting: false,
      successMsg: null,
      formError: null,

      // Context
      collector: {},
      villages: [],
      locations: [],

      // Donor search
      donorSearchText: '',
      donorResults: [],
      selectedDonorId: '',

      // Translation suggestions for English → Gujarati
      translationSuggestions: [],

      // Village Autocomplete
      selectedVillageOption: null,
      showVillageDropdown: false,
      filteredVillagesList: [],

      // Form fields
      form: {
        donation_date: '2024-08-01',
        donor_name_guj: '',
        donor_name_eng: '',
        mobile: '',
        village: '',
        amount: '',
        location: '',
      },

      // Hastes
      hastes: [],

      // Timers
      _donorTimer: null,
      _gujTimer: null,
      _engTimer: null,
      _villageTimer: null,
    }
  },

  watch: {
    'form.village'(val) {
      this.onVillageInput(val)
    },
    villages: {
      immediate: true,
      handler(val) {
        this.filteredVillagesList = val || []
      }
    }
  },

  computed: {
    villageOptions() {
      return this.villages.map((v) => ({
        label: v.english_name ? `${v.name} (${v.english_name})` : v.name,
        value: v.name,
      }))
    },
    locationSelectOptions() {
      return [
        { label: '-- Select Location --', value: '' },
        ...this.locations.map((loc) => ({
          label: loc.location_name_english || loc.name,
          value: loc.name,
        })),
      ]
    },
  },

  async created() {
    this.handleOutsideClickBound = this.handleOutsideClick.bind(this)
    document.addEventListener('click', this.handleOutsideClickBound)
    try {
      const ctx = await getFormContext()
      this.collector = ctx.collector
      this.villages = ctx.villages
      this.locations = ctx.locations
    } catch (err) {
      if (err.exc_type === 'PermissionError' || (err.message && err.message.includes('Login to access'))) {
        window.location.href = getLoginUrl('/donation/create')
        return
      }
      let msg = err.message || 'You must be registered as a Collector to access this page.'
      if (msg.includes('/api/method/')) {
        msg = msg.replace(/^\/api\/method\/[a-zA-Z0-9_\.]+\s+/, '')
      }
      msg = msg.replace(/<\/?[^>]+(>|$)/g, "")
      this.contextError = msg
    } finally {
      this.loading = false
    }
  },

  beforeUnmount() {
    document.removeEventListener('click', this.handleOutsideClickBound)
  },

  methods: {
    handleOutsideClick(e) {
      if (e) {
        const villageContainer = document.getElementById('village-container')
        if (villageContainer && !villageContainer.contains(e.target)) {
          this.showVillageDropdown = false
        }
      }
      this.donorResults = []
      this.translationSuggestions = []
      this.hastes.forEach((h) => { h.searchResults = [] })
    },

    // ── Donor Search ──────────────────────────────────────
    onDonorInput() {
      const query = this.donorSearchText.trim()
      this.selectedDonorId = ''
      clearTimeout(this._donorTimer)
      if (query.length < 2) { this.donorResults = []; return }
      this._donorTimer = setTimeout(async () => {
        this.donorResults = await searchDonor(query)
      }, 300)
    },

    selectDonor(donor) {
      this.selectedDonorId = donor.name
      this.form.donor_name_guj = donor.gujarati_fullname || ''
      this.form.donor_name_eng = donor.english_fullname || ''
      this.form.mobile = donor.mobile_number || ''
      this.form.village = donor.village_gujarati_name || ''
      this.showVillageDropdown = false
      this.donorSearchText = `${donor.gujarati_fullname} (${donor.mobile_number || 'N/A'})`
      this.donorResults = []
    },

    // ── Gujarati → English translation ───────────────────
    onGujInput() {
      this.selectedDonorId = ''
      const val = this.form.donor_name_guj.trim()
      clearTimeout(this._gujTimer)
      if (!val) { this.form.donor_name_eng = ''; return }
      this._gujTimer = setTimeout(async () => {
        const res = await getTranslation(val)
        if (res && res.english) this.form.donor_name_eng = res.english
      }, 250)
    },

    // ── English → Gujarati suggestions ───────────────────
    onEngInput() {
      this.selectedDonorId = ''
      const val = this.form.donor_name_eng.trim()
      clearTimeout(this._engTimer)
      if (!val) { this.translationSuggestions = []; return }
      this._engTimer = setTimeout(async () => {
        const res = await getTranslation(val)
        this.translationSuggestions = (res && res.options) ? res.options : []
      }, 250)
    },

    selectTranslation(opt) {
      this.form.donor_name_guj = opt
      this.translationSuggestions = []
    },

    // ── Village ───────────────────────────────────────────
    onVillageInput(val) {
      clearTimeout(this._villageTimer)
      this._villageTimer = setTimeout(() => {
        const query = (val || '').trim().toLowerCase()
        if (!query) {
          this.filteredVillagesList = this.villages
          return
        }
        this.filteredVillagesList = this.villages.filter((v) => {
          const name = (v.name || '').toLowerCase()
          const eng = (v.english_name || '').toLowerCase()
          return name.includes(query) || eng.includes(query)
        })
      }, 200)
    },

    selectVillage(v) {
      this.form.village = v.name
      this.showVillageDropdown = false
    },

    // ── Hastes ────────────────────────────────────────────
    addHaste() {
      this.hastes.push({
        id: Date.now(),
        displayText: '',
        personId: '',
        searchResults: [],
        _timer: null,
      })
    },

    removeHaste(idx) {
      this.hastes.splice(idx, 1)
    },

    onHasteInput(idx) {
      const haste = this.hastes[idx]
      haste.personId = ''
      const q = haste.displayText.trim()
      clearTimeout(haste._timer)
      if (q.length < 2) { haste.searchResults = []; return }
      haste._timer = setTimeout(async () => {
        haste.searchResults = await searchDonor(q)
      }, 300)
    },

    selectHastePerson(donor, idx) {
      const haste = this.hastes[idx]
      haste.personId = donor.name
      haste.displayText = donor.gujarati_fullname
      haste.searchResults = []
    },

    // ── Submit ────────────────────────────────────────────
    async submitForm() {
      this.formError = null
      this.successMsg = null

      const amount = parseInt(this.form.amount)
      if (!amount || amount <= 0) { this.formError = 'Please enter a valid donation amount.'; return }
      if (!this.form.donor_name_guj.trim()) { this.formError = 'Donor Gujarati name is required.'; return }
      if (!this.form.village) { this.formError = 'Village is required.'; return }
      if (!this.form.location) { this.formError = 'Location is required.'; return }

      const hasteValues = this.hastes
        .map((h) => (h.personId ? h.personId : h.displayText.trim()))
        .filter(Boolean)

      this.submitting = true
      try {
        const res = await createWebDonation({
          donor_data: JSON.stringify({
            name: this.selectedDonorId,
            gujarati_fullname: this.form.donor_name_guj.trim(),
            english_fullname: this.form.donor_name_eng.trim(),
            mobile_number: this.form.mobile.trim(),
          }),
          amount,
          village: this.form.village,
          location: this.form.location,
          donation_date: this.form.donation_date,
          hastes: JSON.stringify(hasteValues),
        })

        if (res && res.status === 'success') {
          this.successMsg = {
            title: `Donation of ₹${amount} from ${res.donor_name} saved successfully!`,
            donationId: res.donation_id,
          }
          this.resetForm()
        } else {
          this.formError = 'Failed to save donation. Please try again.'
        }
      } catch (err) {
        let msg = err.message || 'An error occurred while saving the donation.'
        if (err.messages && Array.isArray(err.messages)) {
          msg = err.messages.map(m => {
            try {
              const parsed = JSON.parse(m)
              return parsed.message || parsed
            } catch {
              return m
            }
          }).join('\n')
        }
        if (msg.includes('/api/method/')) {
          msg = msg.replace(/^\/api\/method\/[a-zA-Z0-9_\.]+\s+/, '')
        }
        if (msg.includes('DuplicateEntryError')) {
          msg = 'A duplicate entry error occurred. This donor, village, or location might already exist.'
        }
        msg = msg.replace(/<\/?[^>]+(>|$)/g, "")
        this.formError = msg
      } finally {
        this.submitting = false
      }
    },

    resetForm() {
      this.selectedDonorId = ''
      this.donorSearchText = ''
      this.selectedVillageOption = null
      this.showVillageDropdown = false
      this.hastes = []
      this.form = {
        donation_date: '2024-08-01',
        donor_name_guj: '',
        donor_name_eng: '',
        mobile: '',
        village: '',
        amount: '',
        location: '',
      }
    },
  },
}
</script>

<style scoped>
.pl-7 {
  padding-left: 1.75rem !important;
}
.form-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 1rem;
  padding-right: 2.5rem;
}
</style>
