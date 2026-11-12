// 管理页和后台说话：登录、读写菜单、管理员名单、邀请码、审核、加菜权限。通用部分见 src/api-client.js。

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

// ---- 审核、共享菜、加菜权限（阶段 4-4，R-024、R-029） ----
export const listReviews = (opts) => request('/api/admin/reviews', opts).then((r) => r.data.reviews)
/**
 * 通过；dish 不传就用用户填的，传了就是管理员改过的。
 * revision 是列表里看到的那一版：用户在这期间改过、重新提交过，后台会拒绝（要刷新再审）
 */
export const approveReview = (id, revision, dish, opts) =>
  request(`/api/admin/reviews/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: dish ? { revision, dish } : { revision },
    ...opts,
  }).then((r) => r.data.dish)
export const rejectReview = (id, revision, note, opts) =>
  request(`/api/admin/reviews/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { revision, note }, ...opts })
export const promoteDish = (id, opts) => request(`/api/admin/dishes/${encodeURIComponent(id)}/promote`, { method: 'POST', body: {}, ...opts })
export const getDishAccess = (opts) => request('/api/admin/dish-access', opts).then((r) => r.data)
export const setDishesOpen = (open, opts) => request('/api/admin/dish-access', { method: 'PUT', body: { open }, ...opts }).then((r) => r.data)
export const setUserList = (userId, list, opts) =>
  request(`/api/admin/dish-access/${encodeURIComponent(userId)}`, { method: 'PUT', body: { list }, ...opts }).then((r) => r.data)
/** 上传一张（已压缩的）图片，返回文件名（up_ 开头），填进菜的 image（阶段 4-4d） */
export const uploadImage = (blob, opts) => request('/api/images', { method: 'POST', body: blob, ...opts }).then((r) => r.data.image)
/** 图片存储用了多少（R2 免费 10 GB），管理页进度条用 */
export const getStorage = (opts) => request('/api/admin/storage', opts).then((r) => r.data)
