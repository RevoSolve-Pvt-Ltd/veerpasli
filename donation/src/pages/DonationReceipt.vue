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
    <div v-else class="w-full px-4 py-8 flex flex-col items-center">

      <!-- Actions Bar (hidden on print) -->
      <div class="w-full flex items-center justify-between mb-6 no-print max-w-4xl">
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
      <div id="receipt-card" class="bg-white border-2 border-black rounded-lg receipt-card">
        <div class="receipt-inner p-10">

          <!-- Header -->
          <div class="text-center mb-10">
            <h1 class="text-3xl font-extrabold text-black tracking-wide mb-1">
              Veerpasli Donation {{ donationYear }}
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
                <span v-if="data.takti_english" class="translation-val">
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
                <span v-if="data.village_english" class="translation-val">
                  ({{ data.village_english }})
                </span>
              </span>
            </div>
            <div class="receipt-field flex-1">
              <span class="field-label">Location / સ્થળ:</span>
              <span class="field-value">
                {{ data.donation.location }}
                <span v-if="data.location_english" class="translation-val">
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
                <span v-if="data.collector_name_eng" class="translation-val">
                  ({{ data.collector_name_eng }})
                </span>
              </span>
            </div>
          </div>

          <!-- Haste / હસ્તે Row -->
          <div class="receipt-row mb-8">
            <div class="receipt-field w-full">
              <span class="field-label">Haste / હસ્તે:</span>
              <span class="field-value font-bold">{{ hasteNamesList }}</span>
            </div>
          </div>



        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { Button, FeatherIcon, LoadingIndicator } from 'frappe-ui'
import { getDonationReceipt, getLoginUrl, isLoggedIn } from '@/utils/api'

export default {
  name: 'DonationReceipt',

  components: { Button, FeatherIcon, LoadingIndicator },

  data() {
    return {
      loading: true,
      redirecting: false,
      error: null,
      data: null,
      downloading: false,
    }
  },

  computed: {
    donationYear() {
      if (this.data && this.data.donation && this.data.donation.donation_date) {
        return this.data.donation.donation_date.split('-')[0]
      }
      return new Date().getFullYear()
    },
    hasteNamesList() {
      if (!this.data || !this.data.donors_list || this.data.donors_list.length === 0) return 'N/A'
      return this.data.donors_list.map(d => {
        const namePart = d.english_fullname 
          ? `${d.gujarati_fullname} (${d.english_fullname})` 
          : d.gujarati_fullname
        return `${namePart} - ₹${d.amount}`
      }).join(', ')
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
      if (!isLoggedIn()) {
        this.redirecting = true
        window.location.href = getLoginUrl(`/donation/receipt/${name}`)
        return
      }
      const isAuthError = err.exc_type === 'PermissionError' || 
                          (err.message && (
                            err.message.includes('not registered as a Collector') || 
                            err.message.includes('CSRF') ||
                            err.message.includes('Not permitted')
                          ));
      if (isAuthError) {
        this.redirecting = true
        window.location.href = '/app'
        return
      }
      let msg = err.message || 'Failed to load receipt.'
      if (msg.includes('/api/method/')) {
        msg = msg.replace(/^\/api\/method\/[a-zA-Z0-9_\.]+\s+/, '')
      }
      msg = msg.replace(/<\/?[^>]+(>|$)/g, "")
      this.error = msg
    } finally {
      if (!this.redirecting) {
        this.loading = false
      }
    }
  },

  methods: {
    printReceipt() {
      window.print()
    },

    async downloadPdf() {
      this.downloading = true
      const element = document.getElementById('receipt-card')
      try {
        // Dynamically import html2pdf
        const html2pdf = (await import('html2pdf.js')).default
        if (element) element.classList.add('force-landscape')
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
        if (element) element.classList.remove('force-landscape')
        this.downloading = false
      }
    },
  },
}
</script>

<style scoped>
.receipt-card {
  width: 90%;
  max-width: 950px;
  margin: 0 auto;
}

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
  font-size: 0.9rem;
  padding-bottom: 2px;
}

.field-value {
  border-bottom: 1.5px solid #000;
  flex-grow: 1;
  padding-left: 12px;
  padding-bottom: 2px;
  font-size: 0.95rem;
  color: #000;
  min-height: 28px;
  word-break: break-word;
}

.translation-val {
  font-size: 0.8rem;
  font-weight: normal;
  color: #6b7280;
  margin-left: 4px;
}

/* Responsiveness for mobile screen view */
@media (max-width: 640px) {
  .receipt-card {
    width: 95%;
  }
  .receipt-row {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }
  .receipt-field {
    margin-left: 0 !important;
  }
  .field-label {
    font-size: 0.85rem;
  }
  .field-value {
    font-size: 0.9rem;
  }
  .translation-val {
    font-size: 0.75rem;
  }
}

/* Landscape force for PDF download */
.force-landscape .receipt-row {
  display: flex !important;
  flex-direction: row !important;
  gap: 1.5rem !important;
}
.force-landscape .receipt-field {
  display: flex !important;
}

@media print {
  @page {
    size: landscape;
    margin: 0.4in;
  }
  .no-print {
    display: none !important;
  }
  .receipt-card {
    width: 90% !important;
    margin: 0 auto !important;
  }
  .receipt-row {
    display: flex !important;
    flex-direction: row !important;
  }
  .receipt-field {
    display: flex !important;
  }
}
</style>
