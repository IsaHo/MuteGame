const BASE = '/api';

export const formatRial = (n) => {
  if (!n && n !== 0) return '۰ ریال';
  return Number(n).toLocaleString('fa-IR') + ' ریال';
};

export const formatMinutes = (m) => {
  if (!m) return '۰ دقیقه';
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h === 0) return `${min} دقیقه`;
  return `${h} ساعت و ${min} دقیقه`;
};

export const formatDate = (d) => {
  if (!d) return '-';
  return new Date(d).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
};

const req = async (path, opts = {}) => {
  const token = localStorage.getItem('mg_token');
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'خطا در ارتباط با سرور');
  return data;
};

export const api = {
  // Auth
  adminLogin: (u, p) => req('/auth/admin/login', { method: 'POST', body: { username: u, password: p } }),

  // Users
  getUsers: () => req('/users'),
  createUser: (data) => req('/users', { method: 'POST', body: data }),
  updateUser: (id, data) => req(`/users/${id}`, { method: 'PUT', body: data }),
  toggleUser: (id) => req(`/users/${id}/toggle`, { method: 'POST' }),
  deleteUser: (id) => req(`/users/${id}`, { method: 'DELETE' }),
  chargeUser: (id, amount, desc) => req(`/users/${id}/charge`, { method: 'POST', body: { amount, description: desc } }),
  getUserTransactions: (id) => req(`/users/${id}/transactions`),

  // Clients
  getClients: () => req('/clients'),
  kickClient: (sid) => req(`/clients/${sid}/kick`, { method: 'POST' }),
  messageClient: (sid, text) => req(`/clients/${sid}/message`, { method: 'POST', body: { text } }),
  extendClient: (sid, minutes) => req(`/clients/${sid}/extend`, { method: 'POST', body: { minutes } }),

  // Shop
  getShopItems: () => req('/shop/items'),
  createShopItem: (data) => req('/shop/items', { method: 'POST', body: data }),
  updateShopItem: (id, data) => req(`/shop/items/${id}`, { method: 'PUT', body: data }),
  deleteShopItem: (id) => req(`/shop/items/${id}`, { method: 'DELETE' }),
  createOrder: (data) => req('/shop/orders', { method: 'POST', body: data }),
  getOrders: () => req('/shop/orders'),

  // Reports
  getRevenueReport: (days) => req(`/reports/revenue?days=${days}`),
  getShopReport: (days) => req(`/reports/shop?days=${days}`),
  getStats: () => req('/reports/stats'),
  getSessions: () => req('/sessions'),

  // Accounting
  getAccountingData: (days) => Promise.all([
    req(`/reports/revenue?days=${days}`),
    req(`/reports/shop?days=${days}`),
    req('/reports/stats'),
  ]),
};
