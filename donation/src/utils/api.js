import { frappeRequest } from 'frappe-ui'

export function isLoggedIn() {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; user_id=`);
  if (parts.length === 2) {
    const userId = decodeURIComponent(parts.pop().split(';').shift());
    return userId && userId !== 'Guest' && userId !== '';
  }
  return false;
}

export function getLoginUrl(redirectToPath = '/donation') {
  let loginUrl = '/login'
  let redirectUrl = window.location.origin + redirectToPath

  if (window.location.port === '8080') {
    // Development (Vite dev server) -> Redirect to Frappe server on port 8000
    loginUrl = `${window.location.protocol}//${window.location.hostname}:8000/login`
  }

  return `${loginUrl}?redirect-to=${encodeURIComponent(redirectUrl)}`
}

export async function logout() {
  return await frappeRequest({
    url: 'veerpasli.api.logout',
    method: 'POST',
  })
}

export async function login(usr, pwd) {
  return await frappeRequest({
    url: 'veerpasli.api.login',
    method: 'POST',
    params: { usr, pwd },
  })
}

export async function getDonationsDashboard(params = {}) {
  return await frappeRequest({
    url: 'veerpasli.api.get_donations',
    method: 'POST',
    params,
  })
}

export async function getFormContext() {
  return await frappeRequest({
    url: 'veerpasli.api.get_form_context',
    method: 'POST',
  })
}

export async function getDonationReceipt(name) {
  return await frappeRequest({
    url: 'veerpasli.api.get_donation_receipt',
    method: 'POST',
    params: { name },
  })
}

export async function searchDonor(query) {
  return await frappeRequest({
    url: 'veerpasli.api.search_donor',
    method: 'POST',
    params: { query },
  })
}

export async function getTranslation(text) {
  return await frappeRequest({
    url: 'veerpasli.api.get_translation',
    method: 'POST',
    params: { text },
  })
}

export async function createWebDonation(donationData) {
  return await frappeRequest({
    url: 'veerpasli.api.create_donation',
    method: 'POST',
    params: donationData,
  })
}
