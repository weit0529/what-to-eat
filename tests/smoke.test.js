// 冒烟测试：只确认测试环境能跑通、根组件能正常渲染。
// 功能开发开始后，核心逻辑和转换脚本的测试也放在 tests/ 目录下。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import App from '../src/App.vue'

describe('开发环境', () => {
  it('根组件能渲染出标题', () => {
    const wrapper = mount(App)
    expect(wrapper.find('h1').text()).toBe('今天吃什么？')
  })
})
