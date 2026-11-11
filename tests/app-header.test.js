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
