import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, vi } from 'vitest'

afterEach(() => {
  cleanup()
})

beforeAll(() => {
  class ResizeObserverMock {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }

  globalThis.ResizeObserver = ResizeObserverMock

  globalThis.FileReader = class FileReaderMock {
    constructor() {
      this.result = null
      this.onload = null
      this.onerror = null
    }

    readAsDataURL(file) {
      this.result = `data:${file.type};base64,${file.name}`
      queueMicrotask(() => {
        this.onload?.({ target: this })
      })
    }
  }

  globalThis.Image = class ImageMock {
    constructor() {
      this.width = 640
      this.height = 480
      this.naturalWidth = 640
      this.naturalHeight = 480
      this.onload = null
      this.onerror = null
      this._src = ''
    }

    get src() {
      return this._src
    }

    set src(value) {
      this._src = value
      queueMicrotask(() => {
        this.onload?.()
      })
    }
  }

  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  }))
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,export')
  HTMLAnchorElement.prototype.click = vi.fn()

  if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => 'test-uuid',
      },
    })
  }
})
