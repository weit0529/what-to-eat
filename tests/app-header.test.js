// 页面标题区（src/App.vue）的测试：标题旁有 Logo
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import App from '../src/App.vue'

describe('App 标题', () => {
  it('标题旁显示 Logo，Logo 是装饰图，读屏只读标题文字', () => {
    const w = mount(App, { props: { remote: false } })
    const logo = w.find('.app-header img.logo')
    expect(logo.exists()).toBe(true)
    expect(logo.attributes('src').endsWith('logo.png')).toBe(true)
    expect(logo.attributes('alt')).toBe('')
    expect(w.find('.app-header h1').text()).toBe('今天吃什么？')
  })
})

describe('页面底部的账号入口（阶段 4-3）', () => {
  it('没登录显示“登录 / 注册”，链到账号页', () => {
    localStorage.clear()
    const link = mount(App, { props: { remote: false } }).find('.account-link')
    expect(link.text()).toBe('登录 / 注册')
    expect(link.attributes('href')).toMatch(/account\/$/)
  })

  it('登录过显示“我的账号（名字）”', () => {
    localStorage.setItem('what-to-eat:user-token:v1', 'tok')
    localStorage.setItem('what-to-eat:user-name:v1', '小明')
    expect(mount(App, { props: { remote: false } }).find('.account-link').text()).toBe('我的账号（小明）')
    localStorage.clear()
  })
})
