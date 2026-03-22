import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./modelScene', () => ({
  createModelViewer: vi.fn(),
}))

vi.mock('./effects', async () => {
  const actual = await vi.importActual('./effects')
  return {
    ...actual,
    drawDraftRegion: vi.fn(),
    renderEffect: vi.fn(),
  }
})

import App from './App'
import { renderEffect } from './effects'
import { createModelViewer } from './modelScene'

const makeRect = (width, height) => ({
  width,
  height,
  top: 0,
  left: 0,
  right: width,
  bottom: height,
  x: 0,
  y: 0,
  toJSON: () => ({}),
})

const createViewerMock = () => {
  const state = {
    dragging: false,
  }

  return {
    dispose: vi.fn(),
    isDragging: vi.fn(() => state.dragging),
    loadModel: vi.fn().mockResolvedValue({}),
    onPointerDown: vi.fn(() => {
      state.dragging = true
    }),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(() => {
      state.dragging = false
    }),
    render: vi.fn(() => ({ kind: 'model-frame' })),
    setViewport: vi.fn(),
  }
}

let rafQueue = []
let rafId = 1
let performanceNow = 0
let performanceNowSpy

beforeEach(() => {
  vi.clearAllMocks()
  rafQueue = []
  rafId = 1
  performanceNow = 0
  performanceNowSpy?.mockRestore()
  performanceNowSpy = vi.spyOn(performance, 'now').mockImplementation(() => performanceNow)

  globalThis.requestAnimationFrame = vi.fn((callback) => {
    const id = rafId
    rafId += 1
    rafQueue.push({ callback, id })
    return id
  })

  globalThis.cancelAnimationFrame = vi.fn((id) => {
    rafQueue = rafQueue.filter((entry) => entry.id !== id)
  })
})

const flushMicrotasks = async (turns = 5) => {
  await act(async () => {
    for (let index = 0; index < turns; index += 1) {
      await Promise.resolve()
    }
  })
}

const flushFrame = async (time) => {
  const nextFrame = rafQueue.shift()
  expect(nextFrame).toBeDefined()
  await act(async () => {
    performanceNow = time
    nextFrame.callback(time)
    await Promise.resolve()
  })
}

const flushFrameIfPending = async (time) => {
  if (!rafQueue.length) {
    return false
  }
  await flushFrame(time)
  return true
}

const getPendingFrameCount = () => rafQueue.length

const getLastRenderCall = () => renderEffect.mock.calls.at(-1)?.[0]

const setPreviewRect = (container, width = 800, height = 600) => {
  const rect = makeRect(width, height)
  const previewFrame = container.querySelector('.preview-frame')
  const previewCanvas = container.querySelector('.preview-canvas')
  previewFrame.getBoundingClientRect = vi.fn(() => rect)
  previewCanvas.getBoundingClientRect = vi.fn(() => rect)
  return previewCanvas
}

const getUploadInput = (label) =>
  screen.getByText(label).closest('label').querySelector('input[type="file"]')

const getSliderInput = (label) =>
  screen.getByText(label).closest('label').querySelector('input[type="range"]')

const clickToggle = (label) => {
  const toggle = screen.getByText(label).closest('.toggle-field').querySelector('button')
  fireEvent.click(toggle)
}

const uploadImage = async () => {
  const file = new File(['image'], 'frame.png', { type: 'image/png' })
  await act(async () => {
    fireEvent.change(getUploadInput('Upload image'), {
      target: { files: [file] },
    })
  })
  await flushMicrotasks()
}

const uploadModel = async () => {
  const file = new File(['model'], 'mesh.obj', { type: 'model/obj' })
  await act(async () => {
    fireEvent.change(getUploadInput('Upload 3D'), {
      target: { files: [file] },
    })
    await Promise.resolve()
  })
  await flushMicrotasks()
}

describe('App rendering regressions', () => {
  it('renders image effect and slider changes on the next frame', async () => {
    createModelViewer.mockReturnValue(createViewerMock())
    const { container } = render(<App />)
    setPreviewRect(container)

    await uploadImage()
    await flushFrame(0)

    expect(getLastRenderCall()).toMatchObject({
      effectId: 'color-htone',
      height: 480,
      width: 640,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Blur' }))
    await flushFrame(16)
    expect(getLastRenderCall().effectId).toBe('blur-suite')

    fireEvent.change(getSliderInput('Blur Strength'), {
      target: { value: '61' },
    })
    await flushFrame(32)

    expect(getLastRenderCall()).toMatchObject({
      effectId: 'blur-suite',
      settings: expect.objectContaining({ intensity: 61 }),
    })
  })

  it('creates one model viewer and disposes it on unmount', async () => {
    const viewer = createViewerMock()
    createModelViewer.mockReturnValue(viewer)

    const { container, unmount } = render(<App />)
    setPreviewRect(container)

    await uploadModel()
    await flushFrame(0)

    fireEvent.change(getSliderInput('Scale'), {
      target: { value: '1.5' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Glitch' }))
    await flushFrame(16)

    expect(createModelViewer).toHaveBeenCalledTimes(1)
    expect(viewer.loadModel).toHaveBeenCalledTimes(1)

    unmount()
    expect(viewer.dispose).toHaveBeenCalledTimes(1)
  })

  it('coalesces rapid 3D updates into one pending frame and renders the latest state', async () => {
    const viewer = createViewerMock()
    createModelViewer.mockReturnValue(viewer)

    const { container } = render(<App />)
    setPreviewRect(container)

    await uploadModel()
    await flushFrame(0)
    await flushFrameIfPending(300)

    renderEffect.mockClear()
    viewer.render.mockClear()

    fireEvent.change(getSliderInput('Scale'), {
      target: { value: '1.8' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Glitch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Vintage' }))

    expect(getPendingFrameCount()).toBe(1)

    await flushFrame(400)

    expect(viewer.render).toHaveBeenLastCalledWith(expect.objectContaining({ scale: 1.8 }))
    expect(getLastRenderCall().effectId).toBe('vintage-kit')
  })

  it('keeps the visible canvas size stable while 3D quality scales up and down', async () => {
    const viewer = createViewerMock()
    createModelViewer.mockReturnValue(viewer)

    const { container } = render(<App />)
    const previewCanvas = setPreviewRect(container)

    await uploadModel()
    await flushFrame(0)

    expect(previewCanvas.width).toBe(800)
    expect(previewCanvas.height).toBe(600)
    expect(viewer.setViewport).toHaveBeenLastCalledWith(560, 420)

    await flushFrame(300)

    expect(previewCanvas.width).toBe(800)
    expect(previewCanvas.height).toBe(600)
    expect(viewer.setViewport).toHaveBeenLastCalledWith(720, 540)
  })

  it('throttles auto-rotate frames instead of rendering every RAF tick', async () => {
    const viewer = createViewerMock()
    createModelViewer.mockReturnValue(viewer)

    const { container } = render(<App />)
    setPreviewRect(container)

    await uploadModel()
    await flushFrame(0)
    await flushFrameIfPending(300)

    renderEffect.mockClear()

    clickToggle('Auto Rotate')
    await flushFrame(1000)

    expect(renderEffect).toHaveBeenCalledTimes(1)
    expect(getPendingFrameCount()).toBe(1)

    await flushFrame(1030)
    expect(renderEffect).toHaveBeenCalledTimes(1)
    expect(getPendingFrameCount()).toBe(1)

    await flushFrame(1090)
    expect(renderEffect).toHaveBeenCalledTimes(2)
  })

  it('applies effect changes immediately even while auto-rotate is active', async () => {
    const viewer = createViewerMock()
    createModelViewer.mockReturnValue(viewer)

    const { container } = render(<App />)
    setPreviewRect(container)

    await uploadModel()
    await flushFrame(0)
    await flushFrameIfPending(300)

    clickToggle('Auto Rotate')
    await flushFrame(1000)

    renderEffect.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Blur' }))
    expect(getPendingFrameCount()).toBe(1)

    await flushFrame(1030)

    expect(renderEffect).toHaveBeenCalledTimes(1)
    expect(getLastRenderCall().effectId).toBe('blur-suite')
  })

  it('keeps rendering scheduled correctly under React StrictMode', async () => {
    const viewer = createViewerMock()
    createModelViewer.mockReturnValue(viewer)

    const { container } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    const previewCanvas = setPreviewRect(container)

    await uploadModel()
    await flushFrame(0)

    expect(previewCanvas.width).toBe(800)
    expect(previewCanvas.height).toBe(600)
    expect(renderEffect).toHaveBeenCalled()
    expect(viewer.setViewport).toHaveBeenCalled()
  })

  it('surfaces a 3D error instead of crashing when the viewer cannot initialize', async () => {
    createModelViewer.mockImplementation(() => {
      throw new Error('Error creating WebGL context.')
    })

    render(<App />)
    await flushMicrotasks()

    expect(
      screen.getByText('3D preview unavailable: Error creating WebGL context.'),
    ).toBeInTheDocument()
  })
})
