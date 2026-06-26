<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Loading State -->
    <div v-if="loading" class="flex items-center justify-center min-h-screen">
      <div class="text-center">
        <LoadingIndicator class="w-8 h-8 text-blue-600 mx-auto mb-3" />
        <p class="text-gray-500 text-sm">Loading receipt…</p>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex items-center justify-center min-h-screen p-4">
      <div class="bg-white rounded-xl shadow-sm border border-red-100 p-8 max-w-md w-full text-center">
        <div class="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <FeatherIcon name="alert-triangle" class="w-6 h-6 text-yellow-500" />
        </div>
        <h3 class="font-semibold text-gray-800 mb-2">Error</h3>
        <p class="text-gray-500 text-sm mb-4">{{ error }}</p>
        <Button variant="solid" @click="$router.push('/')">Go to Dashboard</Button>
      </div>
    </div>

    <!-- Receipt -->
    <div v-else class="max-w-4xl mx-auto px-4 py-8">

      <!-- Actions Bar (hidden on print) -->
      <div class="flex items-center justify-between mb-6 no-print">
        <Button icon-left="arrow-left" @click="$router.push('/')">
          Dashboard
        </Button>
        <div class="flex gap-2">
          <Button
            appearance="primary"
            icon-left="download"
            :loading="downloading"
            @click="downloadPdf"
          >
            Download PDF
          </Button>
          <Button icon-left="printer" @click="printReceipt">
            Print
          </Button>
        </div>
      </div>

      <!-- Receipt Card -->
      <div id="receipt-card" class="bg-white border-2 border-black rounded-lg">
        <div class="receipt-inner p-10">

          <!-- Header -->
          <div class="text-center mb-10">
            <h1 class="text-3xl font-extrabold text-black tracking-wide mb-1">
              Veerpasli Donation
            </h1>
            <p class="text-base font-bold text-gray-700">
              Receipt No: {{ data.donation.name }}
            </p>
          </div>

          <!-- Date Row -->
          <div class="receipt-row mb-8">
            <div class="receipt-field w-full">
              <span class="field-label">Date / તારીખ:</span>
              <span class="field-value">{{ data.donation.donation_date }}</span>
            </div>
          </div>

          <!-- Donor + Phone Row -->
          <div class="receipt-row gap-6 mb-8">
            <div class="receipt-field flex-2">
              <span class="field-label">Name / દાતાનું નામ:</span>
              <span class="field-value font-bold">
                {{ data.takti_gujarati }}
                <span v-if="data.takti_english" class="font-normal text-gray-600">
                  ({{ data.takti_english }})
                </span>
              </span>
            </div>
            <div class="receipt-field flex-1">
              <span class="field-label">Phone / ફોન:</span>
              <span class="field-value">{{ data.takti_mobile || 'N/A' }}</span>
            </div>
          </div>

          <!-- Village + Location Row -->
          <div class="receipt-row gap-6 mb-8">
            <div class="receipt-field flex-1">
              <span class="field-label">Village / ગામ:</span>
              <span class="field-value">
                {{ data.donation.village }}
                <span v-if="data.village_english" class="text-gray-500">
                  ({{ data.village_english }})
                </span>
              </span>
            </div>
            <div class="receipt-field flex-1">
              <span class="field-label">Location / સ્થળ:</span>
              <span class="field-value">
                {{ data.donation.location }}
                <span v-if="data.location_english" class="text-gray-500">
                  ({{ data.location_english }})
                </span>
              </span>
            </div>
          </div>

          <!-- Amount + Collector Row -->
          <div class="receipt-row gap-6 mb-8">
            <div class="receipt-field flex-1">
              <span class="field-label">Cash Amount / રકમ:</span>
              <span class="field-value font-bold">
                ₹{{ data.donation.amount_english }} /-
              </span>
            </div>
            <div class="receipt-field flex-1">
              <span class="field-label">Collector / સંગ્રહકર્તા:</span>
              <span class="field-value">
                {{ data.collector_name_guj }}
                <span v-if="data.collector_name_eng" class="text-gray-500">
                  ({{ data.collector_name_eng }})
                </span>
              </span>
            </div>
          </div>

          <!-- Haste Breakdown (if applicable) -->
          <div
            v-if="showHasteBreakdown"
            class="flex justify-end mt-6"
          >
            <div class="border-2 border-black rounded p-4 max-w-sm w-full">
              <p class="text-xs font-bold uppercase tracking-wider border-b border-black pb-1 mb-3 flex items-center gap-1">
                <FeatherIcon name="users" class="w-3.5 h-3.5" />
                Haste Breakdown / હસ્તે વિગત:
              </p>
              <div
                v-for="(d, i) in data.donors_list"
                :key="i"
                class="flex justify-between text-sm py-1 border-b border-dashed border-gray-200 last:border-0"
              >
                <span>
                  {{ d.gujarati_fullname }}
                  <span v-if="d.english_fullname" class="text-gray-500">({{ d.english_fullname }})</span>
                </span>
                <span class="font-bold">₹{{ d.amount }}</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { Button, FeatherIcon, LoadingIndicator } from 'frappe-ui'
import { getDonationReceipt, getLoginUrl } from '@/utils/api'

export default {
  name: 'DonationReceipt',

  components: { Button, FeatherIcon, LoadingIndicator },

  data() {
    return {
      loading: true,
      error: null,
      data: null,
      downloading: false,
    }
  },

  computed: {
    showHasteBreakdown() {
      if (!this.data || !this.data.donors_list || this.data.donors_list.length === 0) return false
      if (
        this.data.donors_list.length === 1 &&
        this.data.donors_list[0].gujarati_fullname === this.data.takti_gujarati
      )
        return false
      return true
    },
  },

  async created() {
    const name = this.$route.params.name
    if (!name) {
      this.error = 'No donation ID provided.'
      this.loading = false
      return
    }
    try {
      this.data = await getDonationReceipt(name)
    } catch (err) {
      if (err.exc_type === 'PermissionError' || (err.message && err.message.includes('Login to access'))) {
        window.location.href = getLoginUrl(`/donation/receipt/${name}`)
        return
      }
      this.error = err.message || 'Failed to load receipt.'
    } finally {
      this.loading = false
    }
  },

  methods: {
    printReceipt() {
      window.print()
    },

    async downloadPdf() {
      this.downloading = true
      try {
        // Dynamically import html2pdf
        const html2pdf = (await import('html2pdf.js')).default
        const element = document.getElementById('receipt-card')
        const opt = {
          margin: [0.4, 0.4, 0.4, 0.4],
          filename: `Receipt-${this.data.donation.name}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' },
        }
        await html2pdf().set(opt).from(element).save()
      } catch (err) {
        console.error('PDF generation failed', err)
      } finally {
        this.downloading = false
      }
    },
  },
}
</script>

<style scoped>
.receipt-row {
  display: flex;
  align-items: flex-end;
}

.receipt-field {
  display: flex;
  align-items: flex-end;
  flex: 1;
}

.flex-2 {
  flex: 2;
}

.field-label {
  font-weight: 700;
  color: #000;
  white-space: nowrap;
  margin-right: 10px;
  font-size: 1rem;
  padding-bottom: 2px;
}

.field-value {
  border-bottom: 1.5px solid #000;
  flex-grow: 1;
  padding-left: 12px;
  padding-bottom: 2px;
  font-size: 1.05rem;
  color: #000;
  min-height: 28px;
}

@media print {
  @page {
    size: landscape;
    margin: 0.4in;
  }
  .no-print {
    display: none !important;
  }
  .receipt-row {
    display: flex !important;
  }
}
</style>
