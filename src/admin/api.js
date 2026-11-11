// 管理页和后台说话：登录、读写菜单、管理员名单、邀请码。通用部分见 src/api-client.js。

import { createApiClient } from '../api-client.js'

export { ApiError } from '../api-client.js'

const client = createApiClient('what-to-eat:admin-token:v1')
export const { tokenSaveFailed, tokenNotSaved, getToken, request, signIn, currentUser, signOut, changePassword } = client

export const getMenu = (opts) => request('/api/admin/menu', opts).then((r) => r.data)
export const createDish = (dish, opts) => request('/api/admin/dishes', { method: 'POST', body: dish, ...opts }).then((r) => r.data.dish)
export const updateDish = (id, dish, opts) =>
  request(`/api/admin/dishes/${encodeURIComponent(id)}`, { method: 'PUT', body: dish, ...opts }).then((r) => r.data.dish)
export const deleteDish = (id, opts) => request(`/api/admin/dishes/${encodeURIComponent(id)}`, { method: 'DELETE', ...opts })
export const saveMeals = (labels, opts) => request('/api/admin/meals', { method: 'PUT', body: { labels }, ...opts }).then((r) => r.data.meals)
export const importMenu = (payload, opts) => request('/api/admin/import', { method: 'POST', body: payload, ...opts }).then((r) => r.data)
export const listAdmins = (opts) => request('/api/admin/admins', opts).then((r) => r.data.admins)
export const addAdmin = (admin, opts) => request('/api/admin/admins', { method: 'POST', body: admin, ...opts }).then((r) => r.data.admin)
export const removeAdmin = (id, opts) => request(`/api/admin/admins/${encodeURIComponent(id)}`, { method: 'DELETE', ...opts })
export const listInvites = (opts) => request('/api/admin/invites', opts).then((r) => r.data.invites)
export const createInvite = (opts) => request('/api/admin/invites', { method: 'POST', body: {}, ...opts }).then((r) => r.data.invite)
export const revokeInvite = (id, opts) => request(`/api/admin/invites/${encodeURIComponent(id)}`, { method: 'DELETE', ...opts })
