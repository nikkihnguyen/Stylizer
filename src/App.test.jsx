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

vi.mock('./webcamTracker', () => ({
  TRACKING_MODE_OPTIONS: [
    { label: 'Manual', value: 'manual' },
    { label: 'Hands', value: 'hands' },
    { label: 'Face', value: 'face' },
    { label: 'Hands + Face', value: 'hands-face' },
  ],
  createWebcamTracker: vi.fn(),
  getTrackingModeLabel: vi.fn((mode) => ({
    manual: 'Manual',
    hands: 'Hands',
    face: 'Face',
    'hands-face': 'Hands + Face',
  }[mode] ?? mode)),
}))

import App from './App'
import { renderEffect } from './effects'
import { createModelViewer } from './modelScene'
import { createWebcamTracker } from './webcamTracker'

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

const createTrackerMock = () => ({
  close: vi.fn(),
  detect: vi.fn(() => []),
  ensure: vi.fn().mockResolvedValue(undefined),
})

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

  createWebcamTracker.mockResolvedValue(createTrackerMock())
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

const clickSourceAction = (label) => {
  fireEvent.click(screen.getByRole('button', { name: label }))
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

  it('starts the webcam as a live source and renders it through the effect pipeline', async () => {
    createModelViewer.mockReturnValue(createViewerMock())
    const { container } = render(<App />)
    setPreviewRect(container)

    clickSourceAction('Use webcam')
    await flushMicrotasks()
    await flushFrame(0)

    expect(screen.getByText('Webcam live · 1280 × 720')).toBeInTheDocument()
    expect(getLastRenderCall()).toMatchObject({
      effectId: 'color-htone',
      height: 720,
      width: 1280,
    })
    expect(getLastRenderCall().image.tagName).toBe('VIDEO')
  })

  it('shows how to enable finger tracking before a hand-based mode is selected', async () => {
    createModelViewer.mockReturnValue(createViewerMock())

    const { container } = render(<App />)
    setPreviewRect(container)

    clickSourceAction('Use webcam')
    await flushMicrotasks()
    await flushFrame(0)

    expect(
      screen.getByText('Select `Hands` or `Hands + Face` to enable finger regions.'),
    ).toBeInTheDocument()
  })

  it('stops webcam tracks when the webcam source is turned off', async () => {
    const track = { stop: vi.fn() }
    navigator.mediaDevices.getUserMedia.mockResolvedValueOnce({
      getTracks: () => [track],
    })
    createModelViewer.mockReturnValue(createViewerMock())

    const { container } = render(<App />)
    setPreviewRect(container)

    clickSourceAction('Use webcam')
    await flushMicrotasks()
    await flushFrame(0)

    clickSourceAction('Stop webcam')

    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(screen.getByText('No source loaded')).toBeInTheDocument()
  })

  it('detects webcam hands and faces for ImgTrack and renders tracked regions', async () => {
    const tracker = createTrackerMock()
    tracker.detect.mockReturnValue([
      {
        confidence: 0.92,
        height: 180,
        id: 'tracked-face-1',
        kind: 'tracked',
        label: 'Face 1',
        trackingSource: 'face',
        width: 180,
        x: 160,
        y: 120,
      },
      {
        confidence: 0.84,
        height: 140,
        id: 'tracked-left-1',
        kind: 'tracked',
        label: 'Left Hand',
        trackingSource: 'hand',
        width: 140,
        x: 40,
        y: 260,
      },
    ])
    createWebcamTracker.mockResolvedValue(tracker)
    createModelViewer.mockReturnValue(createViewerMock())

    const { container } = render(<App />)
    setPreviewRect(container)

    clickSourceAction('Use webcam')
    await flushMicrotasks()
    await flushFrame(0)

    renderEffect.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'ImgTrack' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hands + Face' }))
    await flushMicrotasks()
    await flushFrame(16)

    expect(tracker.ensure).toHaveBeenCalledWith({
      minConfidence: 0.55,
      mode: 'hands-face',
    })
    expect(tracker.detect).toHaveBeenCalled()
    expect(getLastRenderCall()).toMatchObject({
      effectId: 'img-track',
      regions: expect.arrayContaining([
        expect.objectContaining({
          filter: 'none',
          label: 'Face 1',
          style: 'basic',
          trackingSource: 'face',
        }),
        expect.objectContaining({
          label: 'Left Hand',
          shape: 'rectangle',
          trackingSource: 'hand',
        }),
      ]),
    })
    expect(screen.getByText('Tracked Regions (2)')).toBeInTheDocument()
    expect(screen.getByText('Hands + Face tracking live · 2 regions')).toBeInTheDocument()
  })

  it('adds finger regions on top of hand tracking when finger tracking is enabled', async () => {
    const tracker = createTrackerMock()
    tracker.detect.mockReturnValue([
      {
        confidence: 0.88,
        height: 140,
        id: 'tracked-left-1',
        kind: 'tracked',
        label: 'Left Hand',
        trackingSource: 'hand',
        width: 140,
        x: 40,
        y: 260,
      },
      {
        confidence: 0.88,
        height: 42,
        id: 'tracked-left-thumb',
        kind: 'tracked',
        label: 'Left Thumb',
        trackingSource: 'finger',
        width: 38,
        x: 28,
        y: 232,
      },
      {
        confidence: 0.88,
        height: 48,
        id: 'tracked-left-index',
        kind: 'tracked',
        label: 'Left Index',
        trackingSource: 'finger',
        width: 36,
        x: 52,
        y: 214,
      },
      {
        confidence: 0.88,
        height: 52,
        id: 'tracked-left-middle',
        kind: 'tracked',
        label: 'Left Middle',
        trackingSource: 'finger',
        width: 34,
        x: 74,
        y: 205,
      },
      {
        confidence: 0.88,
        height: 46,
        id: 'tracked-left-ring',
        kind: 'tracked',
        label: 'Left Ring',
        trackingSource: 'finger',
        width: 32,
        x: 94,
        y: 215,
      },
      {
        confidence: 0.88,
        height: 40,
        id: 'tracked-left-pinky',
        kind: 'tracked',
        label: 'Left Pinky',
        trackingSource: 'finger',
        width: 28,
        x: 112,
        y: 226,
      },
    ])
    createWebcamTracker.mockResolvedValue(tracker)
    createModelViewer.mockReturnValue(createViewerMock())

    const { container } = render(<App />)
    setPreviewRect(container)

    clickSourceAction('Use webcam')
    await flushMicrotasks()
    await flushFrame(0)

    fireEvent.click(screen.getByRole('button', { name: 'ImgTrack' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hands' }))
    await flushMicrotasks()
    await flushFrame(16)

    clickToggle('Track Fingers')
    await flushMicrotasks()
    await flushFrame(160)

    expect(tracker.detect).toHaveBeenLastCalledWith(
      expect.any(HTMLVideoElement),
      160,
      expect.objectContaining({
        fingerPadding: 36,
        minConfidence: 0.55,
        mode: 'hands',
        smoothing: 0.58,
        trackFingers: true,
      }),
    )
    expect(getLastRenderCall()).toMatchObject({
      effectId: 'img-track',
      regions: expect.arrayContaining([
        expect.objectContaining({
          label: 'Left Hand',
          trackingSource: 'hand',
        }),
        expect.objectContaining({
          label: 'Left Thumb',
          trackingSource: 'finger',
        }),
        expect.objectContaining({
          label: 'Left Index',
          trackingSource: 'finger',
        }),
      ]),
    })
    expect(screen.getByText('Tracked Regions (6)')).toBeInTheDocument()
    expect(screen.getByText('Hands + Fingers tracking live · 6 regions')).toBeInTheDocument()
  })

  it('uses thumb and index pinch distance to drive the active effect intensity', async () => {
    const tracker = createTrackerMock()
    tracker.detect.mockReturnValue({
      pinch: {
        confidence: 0.94,
        detected: true,
        handedness: 'Left',
        ratio: 0.25,
      },
      regions: [],
    })
    createWebcamTracker.mockResolvedValue(tracker)
    createModelViewer.mockReturnValue(createViewerMock())

    const { container } = render(<App />)
    setPreviewRect(container)

    clickSourceAction('Use webcam')
    await flushMicrotasks()
    await flushFrame(0)

    fireEvent.click(screen.getByRole('button', { name: 'Blur' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hands' }))
    await flushMicrotasks()
    await flushFrame(16)

    clickToggle('Use Pinch For Effect')
    await flushMicrotasks()
    await flushFrame(160)

    expect(getLastRenderCall()).toMatchObject({
      effectId: 'blur-suite',
      settings: expect.objectContaining({
        intensity: 50,
      }),
    })
    expect(screen.getByText('Pinch thumb and index to control Blur Strength.')).toBeInTheDocument()
  })

  it('uses thumb and index pinch distance to drive ImgTrack filter intensity inside tracked regions', async () => {
    const tracker = createTrackerMock()
    tracker.detect.mockReturnValue({
      pinch: {
        confidence: 0.91,
        detected: true,
        handedness: 'Left',
        ratio: 0.25,
      },
      regions: [
        {
          confidence: 0.86,
          height: 140,
          id: 'tracked-left-1',
          kind: 'tracked',
          label: 'Left Hand',
          trackingSource: 'hand',
          width: 140,
          x: 40,
          y: 260,
        },
      ],
    })
    createWebcamTracker.mockResolvedValue(tracker)
    createModelViewer.mockReturnValue(createViewerMock())

    const { container } = render(<App />)
    setPreviewRect(container)

    clickSourceAction('Use webcam')
    await flushMicrotasks()
    await flushFrame(0)

    fireEvent.click(screen.getByRole('button', { name: 'ImgTrack' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hands' }))
    await flushMicrotasks()
    await flushFrame(16)

    clickToggle('Use Pinch For Effect')
    await flushMicrotasks()
    await flushFrame(160)

    expect(getSliderInput('Filter Intensity').value).toBe('50')
    expect(getLastRenderCall()).toMatchObject({
      effectId: 'img-track',
      regions: expect.arrayContaining([
        expect.objectContaining({
          filterIntensity: 50,
          label: 'Left Hand',
          trackingSource: 'hand',
        }),
      ]),
    })
    expect(screen.getByText('Pinch thumb and index to control Filter Intensity.')).toBeInTheDocument()
  })

  it('applies the ImgTrack invert-region toggle to tracked regions', async () => {
    const tracker = createTrackerMock()
    tracker.detect.mockReturnValue({
      pinch: null,
      regions: [
        {
          confidence: 0.86,
          height: 140,
          id: 'tracked-left-1',
          kind: 'tracked',
          label: 'Left Hand',
          trackingSource: 'hand',
          width: 140,
          x: 40,
          y: 260,
        },
      ],
    })
    createWebcamTracker.mockResolvedValue(tracker)
    createModelViewer.mockReturnValue(createViewerMock())

    const { container } = render(<App />)
    setPreviewRect(container)

    clickSourceAction('Use webcam')
    await flushMicrotasks()
    await flushFrame(0)

    fireEvent.click(screen.getByRole('button', { name: 'ImgTrack' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hands' }))
    await flushMicrotasks()
    await flushFrame(16)

    clickToggle('Invert Region')
    await flushMicrotasks()
    await flushFrame(160)

    expect(getLastRenderCall()).toMatchObject({
      effectId: 'img-track',
      regions: expect.arrayContaining([
        expect.objectContaining({
          invertRegion: true,
          label: 'Left Hand',
          trackingSource: 'hand',
        }),
      ]),
    })
  })

  it('clears tracked webcam regions when switching ImgTrack back to manual mode', async () => {
    const tracker = createTrackerMock()
    tracker.detect.mockReturnValue([
      {
        confidence: 0.89,
        height: 180,
        id: 'tracked-face-1',
        kind: 'tracked',
        label: 'Face 1',
        trackingSource: 'face',
        width: 180,
        x: 160,
        y: 120,
      },
    ])
    createWebcamTracker.mockResolvedValue(tracker)
    createModelViewer.mockReturnValue(createViewerMock())

    const { container } = render(<App />)
    setPreviewRect(container)

    clickSourceAction('Use webcam')
    await flushMicrotasks()
    await flushFrame(0)

    fireEvent.click(screen.getByRole('button', { name: 'ImgTrack' }))
    fireEvent.click(screen.getByRole('button', { name: 'Face' }))
    await flushMicrotasks()
    await flushFrame(16)

    expect(screen.getByText('Tracked Regions (1)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    await flushMicrotasks()
    await flushFrame(32)

    expect(screen.queryByText('Tracked Regions (1)')).not.toBeInTheDocument()
    expect(screen.getByText('Manual regions only.')).toBeInTheDocument()
    expect(getLastRenderCall()).toMatchObject({
      effectId: 'img-track',
      regions: [],
    })
  })
})
