import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import {
  DEFAULT_SETTINGS,
  EFFECTS,
  EMPTY_REGION_STYLE,
  REGION_FILTERS,
  REGION_STYLES,
} from './config'
import { drawDraftRegion, getRegionStyleLabel, makeRegionLabel, renderEffect } from './effects'
import { createModelViewer } from './modelScene'
import {
  createWebcamTracker,
  getTrackingModeLabel,
  TRACKING_MODE_OPTIONS,
} from './webcamTracker'

const PANEL_COLOR_EFFECTS = new Set(['half-tone', 'retroman'])

const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULT_SETTINGS))

const buildInitialTrackState = () => ({
  shape: EMPTY_REGION_STYLE.shape,
  style: EMPTY_REGION_STYLE.style,
  filter: EMPTY_REGION_STYLE.filter,
  invertRegion: false,
  invertScope: 'inside',
  regionFilterIntensity: 100,
  connectionStyle: EMPTY_REGION_STYLE.connectionStyle,
  connectionRate: EMPTY_REGION_STYLE.connectionRate,
  gestureControl: false,
  gestureSensitivity: 100,
  trackingMode: 'manual',
  trackingConfidence: 55,
  trackFingers: false,
  fingerPadding: 36,
  trackingFps: 8,
  trackingSmoothing: 58,
})

const buildInitialModelConfig = () => ({
  scale: 1,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  positionX: 0,
  positionY: 0,
  positionZ: 0,
  lightIntensity: 2.8,
  ambientIntensity: 1.2,
  exposure: 1,
  autoRotate: false,
  wireframe: false,
  background: '#0d0d10',
})

const buildEmptyWebcamInfo = () => ({
  ready: false,
  width: 0,
  height: 0,
})

const buildTrackingStatus = () => ({
  message: 'Manual regions only.',
  state: 'idle',
})

const normalizeTrackedRegion = (region, trackState) => ({
  ...region,
  filter: trackState.filter,
  filterIntensity: trackState.regionFilterIntensity,
  invertRegion: trackState.invertRegion,
  invertScope: trackState.invertScope,
  shape: trackState.shape,
  style: trackState.style,
})

const trackingModeSupportsHands = (mode) => mode === 'hands' || mode === 'hands-face'
const describeTrackingMode = (trackState) =>
  trackState.trackFingers && trackingModeSupportsHands(trackState.trackingMode)
    ? `${getTrackingModeLabel(trackState.trackingMode)} + Fingers`
    : getTrackingModeLabel(trackState.trackingMode)

const GESTURE_CONTROL_TARGETS = {
  'blur-suite': { key: 'intensity', label: 'Blur Strength', max: 100, min: 0, step: 1 },
  'color-htone': { key: 'mix', label: 'Mix', max: 100, min: 0, step: 1 },
  glassify: { key: 'radius', label: 'Radius', max: 200, min: 10, step: 1 },
  'ascii-kit': { key: 'coverage', label: 'Coverage', max: 100, min: 10, step: 1 },
  'image-track': { key: 'strength', label: 'Strength', max: 100, min: 0, step: 1 },
  'img-track': { key: 'regionFilterIntensity', label: 'Filter Intensity', max: 100, min: 0, source: 'track', step: 1 },
  'half-tone': { key: 'dotSize', label: 'Dot Size', max: 20, min: 2, step: 1 },
  retroman: { key: 'scale', label: 'Pixel Scale', max: 8, min: 1, step: 1 },
  'glitch-kit': { key: 'intensity', label: 'Corruption', max: 100, min: 0, step: 1 },
  'vintage-kit': { key: 'sepia', label: 'Sepia', max: 100, min: 0, step: 1 },
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const getGestureControlTarget = (effectId) => GESTURE_CONTROL_TARGETS[effectId] ?? null

const quantizeToStep = (value, min, max, step = 1) => {
  const stepped = Math.round((value - min) / step) * step + min
  return clamp(Number(stepped.toFixed(step < 1 ? 2 : 0)), min, max)
}

const mapPinchRatioToTargetValue = (pinchRatio, target, sensitivity) => {
  const sensitivityScale = sensitivity / 100
  const normalizedPinch = clamp(((pinchRatio * sensitivityScale) - 0.08) / 0.34, 0, 1)
  return quantizeToStep(
    target.min + normalizedPinch * (target.max - target.min),
    target.min,
    target.max,
    target.step,
  )
}

const roundRegionMetric = (value) => Math.round(value * 10) / 10

const areRegionsEquivalent = (left, right) =>
  left.length === right.length
  && left.every((region, index) => {
    const peer = right[index]
    return (
      region.id === peer.id
      && region.label === peer.label
      && region.trackingSource === peer.trackingSource
      && roundRegionMetric(region.confidence ?? 0) === roundRegionMetric(peer.confidence ?? 0)
      && roundRegionMetric(region.x) === roundRegionMetric(peer.x)
      && roundRegionMetric(region.y) === roundRegionMetric(peer.y)
      && roundRegionMetric(region.width) === roundRegionMetric(peer.width)
      && roundRegionMetric(region.height) === roundRegionMetric(peer.height)
    )
  })

const readFileAsUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="chip-row">
      {options.map((option) => (
        <button
          key={option.value}
          className={`chip ${value === option.value ? 'is-active' : ''}`}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function SliderControl({ label, value, min, max, step = 1, onChange }) {
  return (
    <label className="slider-field">
      <div className="slider-header">
        <span>{label}</span>
        <span>{Number(value).toFixed(step < 1 ? 1 : 0)}</span>
      </div>
      <input
        className="slider-input"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  )
}

function ToggleControl({ label, checked, onChange }) {
  return (
    <label className="toggle-field">
      <span>{label}</span>
      <button
        className={`toggle ${checked ? 'is-on' : ''}`}
        onClick={() => onChange(!checked)}
        type="button"
      >
        <span />
      </button>
    </label>
  )
}

function ColorControl({ label, value, onChange }) {
  return (
    <label className="color-field">
      <span>{label}</span>
      <input onChange={(event) => onChange(event.target.value)} type="color" value={value} />
    </label>
  )
}

function SectionTitle({ children }) {
  return <p className="section-kicker">{children}</p>
}

function App() {
  const [effectId, setEffectId] = useState('color-htone')
  const [settings, setSettings] = useState(cloneDefaults)
  const [trackState, setTrackState] = useState(buildInitialTrackState)
  const [modelConfig, setModelConfig] = useState(buildInitialModelConfig)
  const [regions, setRegions] = useState([])
  const [trackedRegions, setTrackedRegions] = useState([])
  const [trackingStatus, setTrackingStatus] = useState(buildTrackingStatus)
  const [selectedRegionId, setSelectedRegionId] = useState(null)
  const [draftRegion, setDraftRegion] = useState(null)
  const [drawing, setDrawing] = useState(null)
  const [sourceKind, setSourceKind] = useState(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [image, setImage] = useState(null)
  const [modelName, setModelName] = useState('')
  const [webcamInfo, setWebcamInfo] = useState(buildEmptyWebcamInfo)
  const [error, setError] = useState('')
  const [fitMode, setFitMode] = useState('contain')

  const canvasRef = useRef(null)
  const previewFrameRef = useRef(null)
  const modelViewerRef = useRef(null)
  const effectCanvasRef = useRef(null)
  const webcamStreamRef = useRef(null)
  const webcamVideoRef = useRef(null)
  const webcamTrackerRef = useRef(null)
  const webcamTrackerPromiseRef = useRef(null)
  const webcamTrackerLoadIdRef = useRef(0)
  const renderStateRef = useRef({
    draftRegion: null,
    effectId,
    image: null,
    modelConfig,
    regions: [],
    selectedRegionId: null,
    settings,
    sourceKind: null,
    trackState,
    trackedRegions: [],
  })
  const renderMetricsRef = useRef({
    sourceWidth: 0,
    sourceHeight: 0,
    displayWidth: 0,
    displayHeight: 0,
  })
  const lowQualityUntilRef = useRef(0)
  const lastModelFrameRef = useRef(0)
  const lastWebcamFrameRef = useRef(0)
  const lastTrackingFrameRef = useRef(0)
  const renderRequestedRef = useRef(true)
  const rafIdRef = useRef(0)
  const requestRenderRef = useRef(() => {})
  const invalidateModelPreviewRef = useRef(() => {})

  const syncRenderState = useCallback((patch) => {
    renderStateRef.current = {
      ...renderStateRef.current,
      ...patch,
    }
  }, [])

  const requestRender = useCallback((interactive = false) => {
    requestRenderRef.current(interactive)
  }, [])

  const invalidateModelPreview = useCallback(() => {
    invalidateModelPreviewRef.current()
  }, [])

  const updateTrackedRegions = useCallback((nextTrackedRegions) => {
    syncRenderState({ trackedRegions: nextTrackedRegions })
    setTrackedRegions((currentRegions) =>
      areRegionsEquivalent(currentRegions, nextTrackedRegions) ? currentRegions : nextTrackedRegions,
    )
  }, [syncRenderState])

  const updateTrackingStatus = useCallback((state, message) => {
    setTrackingStatus((currentStatus) =>
      currentStatus.state === state && currentStatus.message === message
        ? currentStatus
        : { message, state },
    )
  }, [])

  const loadWebcamTracker = useCallback(async () => {
    if (webcamTrackerRef.current) {
      return webcamTrackerRef.current
    }

    if (!webcamTrackerPromiseRef.current) {
      webcamTrackerPromiseRef.current = createWebcamTracker()
        .then((tracker) => {
          webcamTrackerRef.current = tracker
          return tracker
        })
        .catch((trackingError) => {
          webcamTrackerPromiseRef.current = null
          throw trackingError
        })
    }

    return webcamTrackerPromiseRef.current
  }, [])

  const releaseWebcam = useCallback(() => {
    const stream = webcamStreamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
    }
    webcamStreamRef.current = null

    const video = webcamVideoRef.current
    if (video) {
      video.pause?.()
      video.srcObject = null
    }
    webcamVideoRef.current = null
    lastWebcamFrameRef.current = 0
  }, [])

  useEffect(() => {
    let viewer
    try {
      viewer = createModelViewer()
      modelViewerRef.current = viewer
    } catch (viewerError) {
      queueMicrotask(() => {
        setError(
          viewerError instanceof Error
            ? `3D preview unavailable: ${viewerError.message}`
            : '3D preview unavailable on this device/browser.',
        )
      })
      viewer = null
      modelViewerRef.current = null
    }

    effectCanvasRef.current = document.createElement('canvas')
    const nudgeInteractiveQualityWindow = () => {
      lowQualityUntilRef.current = performance.now() + 220
    }
    const ensureRenderLoop = () => {
      if (rafIdRef.current !== 0) {
        return
      }
      rafIdRef.current = requestAnimationFrame((time) => {
        rafIdRef.current = 0

        const canvas = canvasRef.current
        const previewFrame = previewFrameRef.current
        const effectCanvas = effectCanvasRef.current
        if (!canvas || !previewFrame) {
          return
        }

        const displayContext = canvas.getContext('2d', { willReadFrequently: true })
        const effectContext = effectCanvas?.getContext('2d', { willReadFrequently: true })
        const state = renderStateRef.current
        const webcamVideo = webcamVideoRef.current
        const webcamReady = Boolean(
          webcamVideo &&
          webcamVideo.readyState >= 2 &&
          webcamVideo.videoWidth > 0 &&
          webcamVideo.videoHeight > 0,
        )
        const shouldAnimate =
          (state.sourceKind === 'model' && Boolean(viewer) && (state.modelConfig.autoRotate || viewer.isDragging() || time < lowQualityUntilRef.current)) ||
          (state.sourceKind === 'webcam' && webcamReady) ||
          (state.effectId === 'ascii-kit' && state.settings['ascii-kit'].animated)

        if (shouldAnimate && !renderRequestedRef.current) {
          if (state.sourceKind === 'model' && viewer) {
            const targetFps = state.modelConfig.autoRotate ? 12 : viewer.isDragging() ? 20 : 40
            const frameInterval = 1000 / targetFps
            if (time - lastModelFrameRef.current < frameInterval) {
              ensureRenderLoop()
              return
            }
          }

          if (state.sourceKind === 'webcam') {
            const frameInterval = 1000 / 24
            if (time - lastWebcamFrameRef.current < frameInterval) {
              ensureRenderLoop()
              return
            }
          }
        }

        renderRequestedRef.current = false

        let source = null
        let sourceWidth = 0
        let sourceHeight = 0
        let displayWidth = 0
        let displayHeight = 0

        if (state.sourceKind === 'model' && viewer) {
          const bounds = previewFrame.getBoundingClientRect()
          const interacting = state.modelConfig.autoRotate || viewer.isDragging() || time < lowQualityUntilRef.current
          const qualityScale = interacting ? 0.45 : 0.9

          displayWidth = Math.max(1, Math.round(bounds.width))
          displayHeight = Math.max(1, Math.round(bounds.height))
          sourceWidth = Math.min(1280, Math.max(560, Math.round(displayWidth * qualityScale)))
          sourceHeight = Math.min(960, Math.max(420, Math.round(displayHeight * qualityScale)))
          viewer.setViewport(sourceWidth, sourceHeight)
          source = viewer.render(state.modelConfig)
          lastModelFrameRef.current = time
        } else if (state.sourceKind === 'webcam' && webcamReady) {
          sourceWidth = webcamVideo.videoWidth
          sourceHeight = webcamVideo.videoHeight
          source = webcamVideo
          lastWebcamFrameRef.current = time
        } else if (state.image) {
          sourceWidth = state.image.naturalWidth || state.image.width
          sourceHeight = state.image.naturalHeight || state.image.height
          source = state.image
        }

        let trackedRenderRegions = state.trackedRegions
        let pinchGesture = null
        if (
          state.sourceKind === 'webcam'
          && webcamReady
          && state.trackState.trackingMode !== 'manual'
          && (
            state.effectId === 'img-track'
            || (
              state.trackState.gestureControl
              && trackingModeSupportsHands(state.trackState.trackingMode)
              && Boolean(getGestureControlTarget(state.effectId))
            )
          )
          && webcamTrackerRef.current
        ) {
          const trackingFrameInterval = 1000 / Math.max(4, state.trackState.trackingFps)
          if (
            renderRequestedRef.current
            || time - lastTrackingFrameRef.current >= trackingFrameInterval
          ) {
            try {
              const trackingResult = webcamTrackerRef.current.detect(webcamVideo, time, {
                fingerPadding: state.trackState.fingerPadding,
                minConfidence: state.trackState.trackingConfidence / 100,
                mode: state.trackState.trackingMode,
                smoothing: state.trackState.trackingSmoothing / 100,
                trackFingers: state.trackState.trackFingers && trackingModeSupportsHands(state.trackState.trackingMode),
              })
              trackedRenderRegions = Array.isArray(trackingResult)
                ? trackingResult
                : trackingResult.regions ?? []
              pinchGesture = Array.isArray(trackingResult)
                ? null
                : trackingResult.pinch ?? null
              lastTrackingFrameRef.current = time
              updateTrackedRegions(trackedRenderRegions)
              updateTrackingStatus('ready', `${describeTrackingMode(state.trackState)} tracking active.`)
            } catch (trackingError) {
              trackedRenderRegions = []
              lastTrackingFrameRef.current = time
              updateTrackedRegions([])
              updateTrackingStatus(
                'error',
                trackingError instanceof Error
                  ? trackingError.message
                  : 'Unable to run webcam tracking.',
              )
            }
          }
        }

        let currentTrackState = state.trackState
        const gestureTarget = getGestureControlTarget(state.effectId)
        let effectSettings = state.settings[state.effectId]
        if (
          state.sourceKind === 'webcam'
          && state.trackState.gestureControl
          && trackingModeSupportsHands(state.trackState.trackingMode)
          && gestureTarget
          && pinchGesture?.detected
        ) {
          const nextGestureValue = mapPinchRatioToTargetValue(
            pinchGesture.ratio,
            gestureTarget,
            state.trackState.gestureSensitivity,
          )
          if (gestureTarget.source === 'track') {
            if (state.trackState[gestureTarget.key] !== nextGestureValue) {
              currentTrackState = {
                ...state.trackState,
                [gestureTarget.key]: nextGestureValue,
              }
              syncRenderState({ trackState: currentTrackState })
              setTrackState(currentTrackState)
            } else {
              currentTrackState = {
                ...state.trackState,
                [gestureTarget.key]: nextGestureValue,
              }
            }
          } else {
            if (effectSettings[gestureTarget.key] !== nextGestureValue) {
              const nextSettings = {
                ...state.settings,
                [state.effectId]: {
                  ...state.settings[state.effectId],
                  [gestureTarget.key]: nextGestureValue,
                },
              }
              effectSettings = nextSettings[state.effectId]
              syncRenderState({ settings: nextSettings })
              setSettings(nextSettings)
            } else {
              effectSettings = {
                ...effectSettings,
                [gestureTarget.key]: nextGestureValue,
              }
            }
          }
        }
        const effectiveTrackedRegions = trackedRenderRegions.map((region) =>
          normalizeTrackedRegion(region, currentTrackState),
        )
        const renderRegions =
          state.effectId === 'img-track'
            ? [
                ...effectiveTrackedRegions,
                ...state.regions.map((region) => ({
                  ...region,
                  filterIntensity: currentTrackState.regionFilterIntensity,
                  invertRegion: currentTrackState.invertRegion,
                  invertScope: currentTrackState.invertScope,
                })),
              ]
            : state.regions

        if (source && sourceWidth > 0 && sourceHeight > 0) {
          if (state.sourceKind === 'model') {
            if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
              canvas.width = displayWidth
              canvas.height = displayHeight
            }
            if (effectCanvas && (effectCanvas.width !== sourceWidth || effectCanvas.height !== sourceHeight)) {
              effectCanvas.width = sourceWidth
              effectCanvas.height = sourceHeight
            }
          } else if (canvas.width !== sourceWidth || canvas.height !== sourceHeight) {
            canvas.width = sourceWidth
            canvas.height = sourceHeight
          }

          renderMetricsRef.current = {
            sourceWidth,
            sourceHeight,
            displayWidth: state.sourceKind === 'model' ? displayWidth : sourceWidth,
            displayHeight: state.sourceKind === 'model' ? displayHeight : sourceHeight,
          }

          renderEffect({
            context: state.sourceKind === 'model' ? effectContext : displayContext,
            image: source,
            effectId: state.effectId,
            settings: effectSettings,
            width: sourceWidth,
            height: sourceHeight,
            regions: renderRegions,
            selectedRegionId: state.selectedRegionId,
            connectionStyle: state.trackState.connectionStyle,
            connectionRate: state.trackState.connectionRate,
            now: time / 1000,
          })

          if (state.effectId === 'img-track' && state.draftRegion) {
            drawDraftRegion(state.sourceKind === 'model' ? effectContext : displayContext, state.draftRegion)
          }

          if (state.sourceKind === 'model') {
            displayContext.clearRect(0, 0, displayWidth, displayHeight)
            displayContext.drawImage(effectCanvas, 0, 0, displayWidth, displayHeight)
          }
        } else {
          displayContext.clearRect(0, 0, canvas.width, canvas.height)
        }

        if (
          renderRequestedRef.current ||
          (state.sourceKind === 'model' && Boolean(viewer) && (state.modelConfig.autoRotate || viewer.isDragging() || time < lowQualityUntilRef.current)) ||
          (state.sourceKind === 'webcam' && webcamReady) ||
          (state.effectId === 'ascii-kit' && state.settings['ascii-kit'].animated)
        ) {
          ensureRenderLoop()
        }
      })
    }

    requestRenderRef.current = (interactive = false) => {
      if (interactive) {
        nudgeInteractiveQualityWindow()
      }
      renderRequestedRef.current = true
      ensureRenderLoop()
    }

    invalidateModelPreviewRef.current = () => {
      lastModelFrameRef.current = Number.NEGATIVE_INFINITY
      requestRenderRef.current(true)
    }

    const resizeObserver = new ResizeObserver(() => {
      requestRenderRef.current()
    })

    if (previewFrameRef.current) {
      resizeObserver.observe(previewFrameRef.current)
    }

    requestRenderRef.current()

    return () => {
      resizeObserver.disconnect()
      requestRenderRef.current = () => {}
      invalidateModelPreviewRef.current = () => {}
      releaseWebcam()
      webcamTrackerRef.current?.close()
      webcamTrackerRef.current = null
      webcamTrackerPromiseRef.current = null
      modelViewerRef.current = null
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = 0
      }
      viewer?.dispose()
    }
  }, [releaseWebcam, syncRenderState, updateTrackedRegions, updateTrackingStatus])

  useEffect(() => {
    if (!sourceUrl) {
      return
    }

    const nextImage = new Image()
    nextImage.onload = () => {
      syncRenderState({ image: nextImage })
      setImage(nextImage)
      requestRenderRef.current()
    }
    nextImage.onerror = () => setError('Unable to load that image.')
    nextImage.src = sourceUrl
    return () => {
      nextImage.onload = null
      nextImage.onerror = null
    }
  }, [sourceUrl, syncRenderState])

  useEffect(() => {
    const gestureTarget = getGestureControlTarget(effectId)
    const autoTrackingEnabled =
      sourceKind === 'webcam'
      && trackState.trackingMode !== 'manual'
      && (
        effectId === 'img-track'
        || (
          trackState.gestureControl
          && trackingModeSupportsHands(trackState.trackingMode)
          && Boolean(gestureTarget)
        )
      )

    if (!autoTrackingEnabled) {
      lastTrackingFrameRef.current = 0
      updateTrackedRegions([])

      if (trackState.trackingMode === 'manual') {
        updateTrackingStatus('idle', 'Manual regions only.')
      } else if (sourceKind !== 'webcam') {
        updateTrackingStatus('idle', 'Auto tracking requires the webcam source.')
      } else if (effectId !== 'img-track' && !trackState.gestureControl) {
        updateTrackingStatus('idle', 'Switch to ImgTrack to render tracked regions.')
      } else if (!gestureTarget) {
        updateTrackingStatus('idle', 'The current effect does not expose a pinch-controlled intensity parameter.')
      }
      return
    }

    let cancelled = false
    const loadId = webcamTrackerLoadIdRef.current + 1
    webcamTrackerLoadIdRef.current = loadId
    const effectTrackingDescriptor =
      trackState.trackFingers && trackingModeSupportsHands(trackState.trackingMode)
        ? `${getTrackingModeLabel(trackState.trackingMode)} + Fingers`
        : getTrackingModeLabel(trackState.trackingMode)
    updateTrackingStatus(
      'loading',
      `Loading ${effectTrackingDescriptor.toLowerCase()} tracking…`,
    )

    const primeTracker = async () => {
      try {
        const tracker = await loadWebcamTracker()
        await tracker.ensure({
          minConfidence: trackState.trackingConfidence / 100,
          mode: trackState.trackingMode,
        })

        if (cancelled || webcamTrackerLoadIdRef.current !== loadId) {
          return
        }

        lastTrackingFrameRef.current = Number.NEGATIVE_INFINITY
        updateTrackingStatus(
          'ready',
          `${effectTrackingDescriptor} tracking active.`,
        )
        requestRender()
      } catch (trackingError) {
        if (cancelled || webcamTrackerLoadIdRef.current !== loadId) {
          return
        }

        updateTrackedRegions([])
        updateTrackingStatus(
          'error',
          trackingError instanceof Error
            ? trackingError.message
            : 'Unable to start webcam tracking.',
        )
      }
    }

    primeTracker()

    return () => {
      cancelled = true
    }
  }, [
    effectId,
    loadWebcamTracker,
    requestRender,
    sourceKind,
    trackState.gestureControl,
    trackState.gestureSensitivity,
    trackState.trackingConfidence,
    trackState.trackFingers,
    trackState.trackingMode,
    updateTrackedRegions,
    updateTrackingStatus,
  ])

  useEffect(() => {
    syncRenderState({
      draftRegion,
      effectId,
      image,
      modelConfig,
      regions,
      selectedRegionId,
      settings,
      sourceKind,
      trackState,
      trackedRegions,
    })
    requestRenderRef.current(sourceKind === 'model')
  }, [draftRegion, effectId, image, modelConfig, regions, selectedRegionId, settings, sourceKind, syncRenderState, trackState, trackedRegions])

  const currentEffect = EFFECTS.find((effect) => effect.id === effectId)
  const currentSettings = settings[effectId]
  const showStandaloneColor =
    PANEL_COLOR_EFFECTS.has(effectId) || (effectId === 'ascii-kit' && currentSettings.colorMode === 'mono')
  const hasSource =
    sourceKind === 'model'
      ? Boolean(modelName)
      : sourceKind === 'webcam'
        ? webcamInfo.ready
        : Boolean(image)
  const visibleTrackedRegions = trackedRegions.map((region) =>
    normalizeTrackedRegion(region, trackState),
  )
  const trackingModeLabel = getTrackingModeLabel(trackState.trackingMode)
  const trackingDescriptor = describeTrackingMode(trackState)
  const gestureControlTarget = getGestureControlTarget(effectId)
  const trackingSummary =
    trackState.trackingMode === 'manual'
      ? 'Manual regions only.'
      : trackingStatus.state === 'error'
        ? trackingStatus.message
        : sourceKind !== 'webcam'
          ? 'Auto tracking requires the webcam source.'
          : trackingStatus.state === 'loading'
            ? trackingStatus.message
            : visibleTrackedRegions.length > 0
              ? `${trackingDescriptor} tracking live · ${visibleTrackedRegions.length} region${visibleTrackedRegions.length === 1 ? '' : 's'}`
              : trackState.trackFingers && trackingModeSupportsHands(trackState.trackingMode)
                ? `${trackingDescriptor} tracking active · waiting for a face, hand, or fingers.`
                : `${trackingModeLabel} tracking active · waiting for a face or hands.`
  const gestureSummary =
    sourceKind !== 'webcam'
      ? 'Pinch control requires the webcam source.'
      : !trackingModeSupportsHands(trackState.trackingMode)
        ? 'Pinch control requires a hand-based tracking mode.'
        : !gestureControlTarget
          ? 'The current effect does not expose a pinch-controlled intensity parameter.'
          : trackState.gestureControl
            ? `Pinch thumb and index to control ${gestureControlTarget.label}.`
            : `Use thumb and index pinch to control ${gestureControlTarget.label}.`

  const updateSetting = (key, value) => {
    const nextSettings = {
      ...settings,
      [effectId]: {
        ...settings[effectId],
        [key]: value,
      },
    }
    syncRenderState({ settings: nextSettings })
    setSettings(nextSettings)
    if (sourceKind === 'model') {
      invalidateModelPreview()
    } else {
      requestRender()
    }
  }

  const updateTrackState = (key, value) => {
    const nextTrackState = {
      ...trackState,
      [key]: value,
    }
    syncRenderState({ trackState: nextTrackState })
    setTrackState(nextTrackState)
    if (sourceKind === 'model') {
      invalidateModelPreview()
    } else {
      requestRender()
    }
  }

  const updateModelConfig = (key, value) => {
    const nextModelConfig = {
      ...modelConfig,
      [key]: value,
    }
    syncRenderState({ modelConfig: nextModelConfig })
    setModelConfig(nextModelConfig)
    invalidateModelPreview()
  }

  const resetModelConfig = () => {
    const nextModelConfig = buildInitialModelConfig()
    syncRenderState({ modelConfig: nextModelConfig })
    setModelConfig(nextModelConfig)
    invalidateModelPreview()
  }

  const selectEffect = (nextEffectId) => {
    syncRenderState({ effectId: nextEffectId })
    setEffectId(nextEffectId)
    if (sourceKind === 'model') {
      invalidateModelPreview()
    } else {
      requestRender()
    }
  }

  const updateDraftRegion = (nextDraftRegion) => {
    syncRenderState({ draftRegion: nextDraftRegion })
    setDraftRegion(nextDraftRegion)
    requestRender(sourceKind === 'model')
  }

  const updateRegions = (nextRegions, nextSelectedRegionId = selectedRegionId) => {
    syncRenderState({
      regions: nextRegions,
      selectedRegionId: nextSelectedRegionId,
    })
    setRegions(nextRegions)
    setSelectedRegionId(nextSelectedRegionId)
    requestRender(sourceKind === 'model')
  }

  const selectRegion = (nextRegionId) => {
    syncRenderState({ selectedRegionId: nextRegionId })
    setSelectedRegionId(nextRegionId)
    requestRender(sourceKind === 'model')
  }

  const stopWebcam = () => {
    releaseWebcam()
    lastTrackingFrameRef.current = 0
    updateTrackedRegions([])
    updateTrackingStatus('idle', trackState.trackingMode === 'manual' ? 'Manual regions only.' : 'Auto tracking requires the webcam source.')
    syncRenderState({ image: null, sourceKind: null })
    setSourceKind(null)
    setImage(null)
    setSourceUrl('')
    setModelName('')
    setWebcamInfo(buildEmptyWebcamInfo())
    requestRender()
  }

  const startWebcam = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Webcam unavailable in this browser.')
      return
    }

    setError('')
    releaseWebcam()
    lastTrackingFrameRef.current = 0
    updateTrackedRegions([])
    setWebcamInfo(buildEmptyWebcamInfo())

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
        },
      })

      const video = document.createElement('video')
      video.autoplay = true
      video.muted = true
      video.playsInline = true
      video.srcObject = stream

      await new Promise((resolve, reject) => {
        const cleanup = () => {
          video.onloadedmetadata = null
          video.onerror = null
        }
        if (video.readyState >= 1) {
          cleanup()
          resolve()
          return
        }
        video.onloadedmetadata = () => {
          cleanup()
          resolve()
        }
        video.onerror = () => {
          cleanup()
          reject(new Error('Unable to start webcam preview.'))
        }
      })

      await video.play().catch(() => undefined)

      webcamStreamRef.current = stream
      webcamVideoRef.current = video

      const nextWebcamInfo = {
        ready: true,
        width: video.videoWidth || 1280,
        height: video.videoHeight || 720,
      }

      syncRenderState({ image: null, sourceKind: 'webcam' })
      setSourceKind('webcam')
      setImage(null)
      setSourceUrl('')
      setModelName('')
      setFitMode('contain')
      setWebcamInfo(nextWebcamInfo)
      updateTrackingStatus(
        trackState.trackingMode === 'manual' ? 'idle' : 'loading',
        trackState.trackingMode === 'manual'
          ? 'Manual regions only.'
          : `Loading ${describeTrackingMode(trackState).toLowerCase()} tracking…`,
      )
      requestRender()
    } catch (webcamError) {
      releaseWebcam()
      setWebcamInfo(buildEmptyWebcamInfo())
      setError(
        webcamError instanceof Error
          ? webcamError.message
          : 'Unable to access the webcam.',
      )
    }
  }

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('Use an image for image mode.')
      return
    }

    setError('')
    releaseWebcam()
    lastTrackingFrameRef.current = 0
    updateTrackedRegions([])
    updateTrackingStatus('idle', trackState.trackingMode === 'manual' ? 'Manual regions only.' : 'Auto tracking requires the webcam source.')
    setWebcamInfo(buildEmptyWebcamInfo())
    syncRenderState({ image: null, sourceKind: 'image' })
    setSourceKind('image')
    setImage(null)
    setModelName('')
    const nextUrl = await readFileAsUrl(file)
    setSourceUrl(nextUrl)
  }

  const handleModelUpload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    if (!modelViewerRef.current) {
      setError('3D preview unavailable on this device/browser.')
      return
    }

    setError('')
    releaseWebcam()
    lastTrackingFrameRef.current = 0
    updateTrackedRegions([])
    updateTrackingStatus('idle', trackState.trackingMode === 'manual' ? 'Manual regions only.' : 'Auto tracking requires the webcam source.')
    setWebcamInfo(buildEmptyWebcamInfo())
    invalidateModelPreview()
    try {
      await modelViewerRef.current.loadModel(file, modelConfig)
      syncRenderState({ image: null, sourceKind: 'model' })
      setSourceKind('model')
      setModelName(file.name)
      setImage(null)
      setSourceUrl('')
      setFitMode('contain')
      invalidateModelPreview()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to load that 3D file.')
    }
  }

  const exportPng = () => {
    if (!canvasRef.current) {
      return
    }
    const link = document.createElement('a')
    link.href = canvasRef.current.toDataURL('image/png')
    link.download = `${effectId}-${Date.now()}.png`
    link.click()
  }

  const pointerToCanvasPoint = (event) => {
    const canvas = canvasRef.current
    const bounds = canvas.getBoundingClientRect()
    const metrics = renderMetricsRef.current
    const scaleX = (metrics.sourceWidth || canvas.width) / bounds.width
    const scaleY = (metrics.sourceHeight || canvas.height) / bounds.height
    return {
      x: (event.clientX - bounds.left) * scaleX,
      y: (event.clientY - bounds.top) * scaleY,
    }
  }

  const handlePointerDown = (event) => {
    if (!hasSource) {
      return
    }

    if (effectId === 'img-track') {
      event.preventDefault()
      const point = pointerToCanvasPoint(event)
      const nextDraftRegion = {
        id: 'draft',
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
        invertRegion: trackState.invertRegion,
        invertScope: trackState.invertScope,
        shape: trackState.shape,
        style: trackState.style,
        filter: trackState.filter,
        label: 'Draft',
      }
      setDrawing(point)
      updateDraftRegion(nextDraftRegion)
      return
    }

    if (sourceKind === 'model') {
      invalidateModelPreview()
      modelViewerRef.current?.onPointerDown(event)
    }
  }

  const handlePointerMove = (event) => {
    if (drawing && effectId === 'img-track') {
      event.preventDefault()
      const point = pointerToCanvasPoint(event)
      const x = Math.min(point.x, drawing.x)
      const y = Math.min(point.y, drawing.y)
      const width = Math.abs(point.x - drawing.x)
      const height = Math.abs(point.y - drawing.y)
      updateDraftRegion({
        id: 'draft',
        x,
        y,
        width,
        height,
        invertRegion: trackState.invertRegion,
        invertScope: trackState.invertScope,
        shape: trackState.shape,
        style: trackState.style,
        filter: trackState.filter,
        label: 'Draft',
      })
      return
    }

    if (sourceKind === 'model') {
      invalidateModelPreview()
      modelViewerRef.current?.onPointerMove(event)
    }
  }

  const handlePointerUp = () => {
    if (drawing && draftRegion) {
      if (draftRegion.width > 12 && draftRegion.height > 12) {
        const nextRegion = {
          id: crypto.randomUUID(),
          x: draftRegion.x,
          y: draftRegion.y,
          width: draftRegion.width,
          height: draftRegion.height,
          invertRegion: trackState.invertRegion,
          invertScope: trackState.invertScope,
          shape: trackState.shape,
          style: trackState.style,
          filter: trackState.filter,
          label: makeRegionLabel(regions.length),
        }
        updateRegions([...regions, nextRegion], nextRegion.id)
      }
      syncRenderState({ draftRegion: null })
      setDrawing(null)
      setDraftRegion(null)
      requestRender(sourceKind === 'model')
    }

    modelViewerRef.current?.onPointerUp()
    if (sourceKind === 'model') {
      invalidateModelPreview()
    }
  }

  const removeSelectedRegion = () => {
    if (!selectedRegionId) {
      return
    }
    updateRegions(
      regions.filter((region) => region.id !== selectedRegionId),
      null,
    )
  }

  const clearRegions = () => {
    updateRegions([], null)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-block top-bar">
          <div>
            <p className="eyebrow">Stylizer Lab</p>
            <h1>Image + 3D Effects Editor</h1>
            <p className="lede">{currentEffect?.description}</p>
          </div>
          <button className="button button-ghost" onClick={exportPng} type="button">
            Export
          </button>
        </div>

        <div className="sidebar-block">
          <SectionTitle>Source</SectionTitle>
          <div className="source-grid">
            <label className="upload-card">
              <span>Upload image</span>
              <input accept="image/*" onChange={handleImageUpload} type="file" />
            </label>
            <label className="upload-card">
              <span>Upload 3D</span>
              <input accept=".obj,.gltf,.glb,model/gltf-binary,model/gltf+json" onChange={handleModelUpload} type="file" />
            </label>
            <button
              className="upload-card source-action"
              onClick={sourceKind === 'webcam' ? stopWebcam : startWebcam}
              type="button"
            >
              <span>{sourceKind === 'webcam' ? 'Stop webcam' : 'Use webcam'}</span>
            </button>
          </div>
          <p className="source-caption">
            {sourceKind === 'model'
              ? `3D source: ${modelName}`
              : sourceKind === 'webcam'
                ? webcamInfo.ready
                  ? `Webcam live · ${webcamInfo.width} × ${webcamInfo.height}`
                  : 'Starting webcam…'
              : sourceKind === 'image'
                ? 'Image source loaded'
                : 'Supports PNG, JPG, OBJ, GLTF, GLB, and webcam.'}
          </p>
          {error ? <p className="error-text">{error}</p> : null}
        </div>

        {sourceKind === 'webcam' ? (
          <div className="sidebar-block">
            <SectionTitle>Webcam Tracking</SectionTitle>
            <SectionTitle>Tracking Mode</SectionTitle>
            <SegmentedControl
              onChange={(value) => updateTrackState('trackingMode', value)}
              options={TRACKING_MODE_OPTIONS}
              value={trackState.trackingMode}
            />
            {trackState.trackingMode !== 'manual' ? (
              <>
                <SliderControl label="Detection Confidence" max={90} min={30} onChange={(value) => updateTrackState('trackingConfidence', value)} value={trackState.trackingConfidence} />
                <SliderControl label="Tracking FPS" max={18} min={4} onChange={(value) => updateTrackState('trackingFps', value)} value={trackState.trackingFps} />
                <SliderControl label="Stability" max={90} min={0} onChange={(value) => updateTrackState('trackingSmoothing', value)} value={trackState.trackingSmoothing} />
              </>
            ) : null}
            <SectionTitle>Finger Tracking</SectionTitle>
            {trackingModeSupportsHands(trackState.trackingMode) ? (
              <>
                <ToggleControl checked={trackState.trackFingers} label="Track Fingers" onChange={(value) => updateTrackState('trackFingers', value)} />
                {trackState.trackFingers ? (
                  <SliderControl label="Finger Padding" max={80} min={10} onChange={(value) => updateTrackState('fingerPadding', value)} value={trackState.fingerPadding} />
                ) : null}
              </>
            ) : (
              <p className="info-text">Select `Hands` or `Hands + Face` to enable finger regions.</p>
            )}
            <SectionTitle>Gesture Control</SectionTitle>
            {trackingModeSupportsHands(trackState.trackingMode) && gestureControlTarget ? (
              <>
                <ToggleControl checked={trackState.gestureControl} label="Use Pinch For Effect" onChange={(value) => updateTrackState('gestureControl', value)} />
                {trackState.gestureControl ? (
                  <SliderControl label="Pinch Sensitivity" max={160} min={40} onChange={(value) => updateTrackState('gestureSensitivity', value)} value={trackState.gestureSensitivity} />
                ) : null}
              </>
            ) : null}
            <p className={`info-text ${trackingStatus.state === 'error' ? 'is-error' : ''}`}>
              {trackingSummary}
            </p>
            <p className="info-text">{gestureSummary}</p>
          </div>
        ) : null}

        {sourceKind === 'model' ? (
          <div className="sidebar-block">
            <SectionTitle>3D Controls</SectionTitle>
            <SliderControl label="Scale" max={3} min={0.2} onChange={(value) => updateModelConfig('scale', value)} step={0.05} value={modelConfig.scale} />
            <SliderControl label="Rotate X" max={180} min={-180} onChange={(value) => updateModelConfig('rotationX', value)} value={modelConfig.rotationX} />
            <SliderControl label="Rotate Y" max={180} min={-180} onChange={(value) => updateModelConfig('rotationY', value)} value={modelConfig.rotationY} />
            <SliderControl label="Rotate Z" max={180} min={-180} onChange={(value) => updateModelConfig('rotationZ', value)} value={modelConfig.rotationZ} />
            <SliderControl label="Position X" max={3} min={-3} onChange={(value) => updateModelConfig('positionX', value)} step={0.05} value={modelConfig.positionX} />
            <SliderControl label="Position Y" max={3} min={-3} onChange={(value) => updateModelConfig('positionY', value)} step={0.05} value={modelConfig.positionY} />
            <SliderControl label="Position Z" max={3} min={-3} onChange={(value) => updateModelConfig('positionZ', value)} step={0.05} value={modelConfig.positionZ} />
            <SliderControl label="Key Light" max={6} min={0} onChange={(value) => updateModelConfig('lightIntensity', value)} step={0.1} value={modelConfig.lightIntensity} />
            <SliderControl label="Ambient" max={4} min={0} onChange={(value) => updateModelConfig('ambientIntensity', value)} step={0.1} value={modelConfig.ambientIntensity} />
            <SliderControl label="Exposure" max={2.5} min={0.2} onChange={(value) => updateModelConfig('exposure', value)} step={0.05} value={modelConfig.exposure} />
            <ColorControl label="Background" onChange={(value) => updateModelConfig('background', value)} value={modelConfig.background} />
            <ToggleControl checked={modelConfig.autoRotate} label="Auto Rotate" onChange={(value) => updateModelConfig('autoRotate', value)} />
            <ToggleControl checked={modelConfig.wireframe} label="Wireframe" onChange={(value) => updateModelConfig('wireframe', value)} />
            <button className="button button-muted full-width" onClick={resetModelConfig} type="button">
              Reset 3D Controls
            </button>
          </div>
        ) : null}

        <div className="sidebar-block">
          <SectionTitle>Effect</SectionTitle>
          <div className="effect-grid">
            {EFFECTS.map((effect) => (
              <button
                key={effect.id}
                className={`effect-button ${effect.id === effectId ? 'is-active' : ''}`}
                onClick={() => selectEffect(effect.id)}
                type="button"
              >
                {effect.label}
              </button>
            ))}
          </div>
        </div>

        {showStandaloneColor ? (
          <div className="sidebar-block">
            <ColorControl
              label="Color"
              onChange={(value) => updateSetting('color', value)}
              value={currentSettings.color ?? '#f7f7f2'}
            />
          </div>
        ) : null}

        <div className="sidebar-block">
          <SectionTitle>Parameters</SectionTitle>

          {effectId === 'blur-suite' ? (
            <>
              <SectionTitle>Mode</SectionTitle>
              <SegmentedControl
                onChange={(value) => updateSetting('mode', value)}
                options={[
                  { label: 'Linear', value: 'linear' },
                  { label: 'Radial', value: 'radial' },
                  { label: 'Zoom', value: 'zoom' },
                  { label: 'Wave', value: 'wave' },
                  { label: 'TB', value: 'tb' },
                  { label: 'LR', value: 'lr' },
                  { label: 'Tilt-Shift', value: 'tilt-shift' },
                ]}
                value={currentSettings.mode}
              />
              <SliderControl label="Blur Strength" max={100} min={0} onChange={(value) => updateSetting('intensity', value)} value={currentSettings.intensity} />
              <SliderControl label="Grain" max={100} min={0} onChange={(value) => updateSetting('grain', value)} value={currentSettings.grain} />
              <SliderControl label="RGB Shift" max={60} min={0} onChange={(value) => updateSetting('rgbShift', value)} value={currentSettings.rgbShift} />
              <ToggleControl checked={currentSettings.bloom} label="Bloom" onChange={(value) => updateSetting('bloom', value)} />
              {(currentSettings.mode === 'radial' || currentSettings.mode === 'zoom') ? (
                <>
                  <SectionTitle>Motion Center</SectionTitle>
                  <SliderControl label="X Axis" max={100} min={-100} onChange={(value) => updateSetting('motionX', value / 100)} value={Math.round((currentSettings.motionX ?? 0) * 100)} />
                  <SliderControl label="Y Axis" max={100} min={-100} onChange={(value) => updateSetting('motionY', value / 100)} value={Math.round((currentSettings.motionY ?? 0) * 100)} />
                </>
              ) : null}
              {currentSettings.mode !== 'tb' && currentSettings.mode !== 'lr' ? (
                <ToggleControl checked={currentSettings.gradientMask} label="Gradient Mask" onChange={(value) => updateSetting('gradientMask', value)} />
              ) : null}
              {currentSettings.gradientMask && currentSettings.mode !== 'tb' && currentSettings.mode !== 'lr' ? (
                <>
                  <SliderControl label="Mask Direction" max={360} min={0} onChange={(value) => updateSetting('maskDirection', value)} value={currentSettings.maskDirection} />
                  <SliderControl label="Mask Softness" max={100} min={0} onChange={(value) => updateSetting('maskSoftness', value)} value={currentSettings.maskSoftness} />
                  <SliderControl label="Mask Position" max={100} min={0} onChange={(value) => updateSetting('maskPosition', value)} value={currentSettings.maskPosition} />
                </>
              ) : null}
              {(currentSettings.mode === 'tb' || currentSettings.mode === 'lr') ? (
                <>
                  <SliderControl label="Split Position" max={100} min={0} onChange={(value) => updateSetting('maskPosition', value)} value={currentSettings.maskPosition} />
                  <SliderControl label="Softness" max={100} min={0} onChange={(value) => updateSetting('maskSoftness', value)} value={currentSettings.maskSoftness} />
                </>
              ) : null}
              {currentSettings.mode === 'tilt-shift' ? (
                <>
                  <SliderControl label="Focus Y" max={100} min={0} onChange={(value) => updateSetting('focusY', value)} value={currentSettings.focusY} />
                  <SliderControl label="Focus Width" max={80} min={1} onChange={(value) => updateSetting('focusWidth', value)} value={currentSettings.focusWidth} />
                  <SliderControl label="Edge Softness" max={100} min={0} onChange={(value) => updateSetting('softness', value)} value={currentSettings.softness} />
                  <SliderControl label="Saturation Boost" max={100} min={0} onChange={(value) => updateSetting('saturation', value)} value={currentSettings.saturation} />
                </>
              ) : null}
            </>
          ) : null}

          {effectId === 'color-htone' ? (
            <>
              <SectionTitle>Mode</SectionTitle>
              <SegmentedControl onChange={(value) => updateSetting('colorMode', value)} options={[{ label: 'CMYK', value: 'cmyk' }, { label: 'RGB', value: 'rgb' }]} value={currentSettings.colorMode} />
              <SliderControl label="Dot Size" max={24} min={2} onChange={(value) => updateSetting('dotSize', value)} value={currentSettings.dotSize} />
              <SliderControl label="Mix" max={100} min={0} onChange={(value) => updateSetting('mix', value)} value={currentSettings.mix} />
              <SliderControl label="Brightness" max={100} min={-100} onChange={(value) => updateSetting('brightness', value)} value={currentSettings.brightness} />
              <SliderControl label="Contrast" max={100} min={-100} onChange={(value) => updateSetting('contrast', value)} value={currentSettings.contrast} />
              <SectionTitle>Background</SectionTitle>
              <SegmentedControl onChange={(value) => updateSetting('background', value)} options={[{ label: 'White', value: '#ffffff' }, { label: 'Black', value: '#000000' }, { label: 'Paper', value: '#f5f0e8' }]} value={currentSettings.background} />
            </>
          ) : null}

          {effectId === 'glassify' ? (
            <>
              <SliderControl label="Layers" max={30} min={2} onChange={(value) => updateSetting('layers', value)} value={currentSettings.layers} />
              <SliderControl label="Rotation" max={1} min={0} onChange={(value) => updateSetting('rotation', value)} step={0.01} value={currentSettings.rotation} />
              <SliderControl label="Radius" max={200} min={10} onChange={(value) => updateSetting('radius', value)} value={currentSettings.radius} />
              <SliderControl label="Shadow Strength" max={100} min={0} onChange={(value) => updateSetting('shadowStrength', value)} value={currentSettings.shadowStrength} />
              <SliderControl label="Shadow Width" max={10} min={0} onChange={(value) => updateSetting('shadowWidth', value)} value={currentSettings.shadowWidth} />
              <SliderControl label="Highlight Strength" max={100} min={0} onChange={(value) => updateSetting('highlightStrength', value)} value={currentSettings.highlightStrength} />
              <SliderControl label="Highlight Width" max={10} min={0} onChange={(value) => updateSetting('highlightWidth', value)} value={currentSettings.highlightWidth} />
            </>
          ) : null}

          {effectId === 'ascii-kit' ? (
            <>
              <SectionTitle>Render Mode</SectionTitle>
              <SegmentedControl onChange={(value) => updateSetting('renderMode', value)} options={[{ label: 'Brightness', value: 'brightness' }, { label: 'Edges', value: 'edges' }]} value={currentSettings.renderMode} />
              <SectionTitle>Character Set</SectionTitle>
              <SegmentedControl onChange={(value) => updateSetting('charset', value)} options={[{ label: 'Dense', value: 'dense' }, { label: 'Classic', value: 'classic' }, { label: 'Blocks', value: 'blocks' }, { label: 'Binary', value: 'binary' }, { label: 'Minimal', value: 'minimal' }, { label: 'Retro', value: 'retro' }]} value={currentSettings.charset} />
              <SliderControl label="Font Size" max={28} min={6} onChange={(value) => updateSetting('fontSize', value)} step={2} value={currentSettings.fontSize} />
              <SliderControl label="Coverage" max={100} min={10} onChange={(value) => updateSetting('coverage', value)} value={currentSettings.coverage} />
              <SliderControl label="Edge Emphasis" max={100} min={0} onChange={(value) => updateSetting('edgeEmphasis', value)} value={currentSettings.edgeEmphasis} />
              <SectionTitle>Background</SectionTitle>
              <SegmentedControl onChange={(value) => updateSetting('bgMode', value)} options={[{ label: 'Blurred', value: 'blurred' }, { label: 'Original', value: 'original' }, { label: 'Black', value: 'black' }]} value={currentSettings.bgMode} />
              {currentSettings.bgMode === 'blurred' ? <SliderControl label="Blur" max={50} min={0} onChange={(value) => updateSetting('bgBlur', value)} value={currentSettings.bgBlur} /> : null}
              {currentSettings.bgMode !== 'black' ? <SliderControl label="Opacity" max={100} min={0} onChange={(value) => updateSetting('bgOpacity', value)} value={currentSettings.bgOpacity} /> : null}
              <SectionTitle>Color & Tone</SectionTitle>
              <SegmentedControl onChange={(value) => updateSetting('colorMode', value)} options={[{ label: 'True Color', value: 'color' }, { label: 'Custom', value: 'mono' }]} value={currentSettings.colorMode} />
              {currentSettings.colorMode === 'mono' ? <ColorControl label="Color" onChange={(value) => updateSetting('color', value)} value={currentSettings.color} /> : null}
              <SliderControl label="Char Opacity" max={100} min={10} onChange={(value) => updateSetting('charOpacity', value)} value={currentSettings.charOpacity} />
              <SliderControl label="Brightness" max={100} min={-100} onChange={(value) => updateSetting('brightness', value)} value={currentSettings.brightness} />
              <SliderControl label="Contrast" max={100} min={-100} onChange={(value) => updateSetting('contrast', value)} value={currentSettings.contrast} />
              <SliderControl label="Char Brightness" max={100} min={-100} onChange={(value) => updateSetting('charBrightness', value)} value={currentSettings.charBrightness} />
              <SliderControl label="Char Contrast" max={100} min={-100} onChange={(value) => updateSetting('charContrast', value)} value={currentSettings.charContrast} />
              <ToggleControl checked={currentSettings.invertMapping} label="Invert Mapping" onChange={(value) => updateSetting('invertMapping', value)} />
              <ToggleControl checked={currentSettings.dotGrid} label="Dot Grid Overlay" onChange={(value) => updateSetting('dotGrid', value)} />
              <SectionTitle>Animation</SectionTitle>
              <ToggleControl checked={currentSettings.animated} label="Animated ASCII" onChange={(value) => updateSetting('animated', value)} />
              {currentSettings.animated ? (
                <>
                  <SliderControl label="Speed" max={5} min={0.2} onChange={(value) => updateSetting('animSpeed', value)} step={0.1} value={currentSettings.animSpeed} />
                  <SliderControl label="Intensity" max={100} min={10} onChange={(value) => updateSetting('animIntensity', value)} value={currentSettings.animIntensity} />
                  <SliderControl label="Randomness" max={100} min={0} onChange={(value) => updateSetting('animRandomness', value)} value={currentSettings.animRandomness} />
                </>
              ) : null}
            </>
          ) : null}

          {effectId === 'image-track' ? <SliderControl label="Strength" max={100} min={0} onChange={(value) => updateSetting('strength', value)} value={currentSettings.strength} /> : null}
          {effectId === 'half-tone' ? <SliderControl label="Dot Size" max={20} min={2} onChange={(value) => updateSetting('dotSize', value)} value={currentSettings.dotSize} /> : null}
          {effectId === 'retroman' ? <SliderControl label="Pixel Scale" max={8} min={1} onChange={(value) => updateSetting('scale', value)} value={currentSettings.scale} /> : null}

          {effectId === 'glitch-kit' ? (
            <>
              <SliderControl label="Corruption" max={100} min={0} onChange={(value) => updateSetting('intensity', value)} value={currentSettings.intensity} />
              <SliderControl label="Chromatic Shift" max={50} min={0} onChange={(value) => updateSetting('colorShift', value)} value={currentSettings.colorShift} />
              <ToggleControl checked={currentSettings.scanlines} label="Scanlines" onChange={(value) => updateSetting('scanlines', value)} />
            </>
          ) : null}

          {effectId === 'vintage-kit' ? (
            <>
              <SliderControl label="Film Grain" max={100} min={0} onChange={(value) => updateSetting('grain', value)} value={currentSettings.grain} />
              <SliderControl label="Sepia" max={100} min={0} onChange={(value) => updateSetting('sepia', value)} value={currentSettings.sepia} />
              <SliderControl label="Vignette" max={100} min={0} onChange={(value) => updateSetting('vignette', value)} value={currentSettings.vignette} />
            </>
          ) : null}

          {effectId === 'img-track' ? (
            <>
              <SliderControl label="Filter Intensity" max={100} min={0} onChange={(value) => updateTrackState('regionFilterIntensity', value)} value={trackState.regionFilterIntensity} />
              <SectionTitle>Shape</SectionTitle>
              <SegmentedControl onChange={(value) => updateTrackState('shape', value)} options={[{ label: 'Rectangle', value: 'rectangle' }, { label: 'Circle', value: 'circle' }, { label: 'Ellipse', value: 'ellipse' }]} value={trackState.shape} />
              <SectionTitle>Region Style</SectionTitle>
              <SegmentedControl onChange={(value) => updateTrackState('style', value)} options={REGION_STYLES.map((style) => ({ label: style.label, value: style.id }))} value={trackState.style} />
              <ToggleControl checked={trackState.invertRegion} label="Invert Region" onChange={(value) => updateTrackState('invertRegion', value)} />
              {trackState.invertRegion ? (
                <>
                  <SectionTitle>Invert Scope</SectionTitle>
                  <SegmentedControl
                    onChange={(value) => updateTrackState('invertScope', value)}
                    options={[
                      { label: 'Inside', value: 'inside' },
                      { label: 'Outside', value: 'outside' },
                    ]}
                    value={trackState.invertScope}
                  />
                </>
              ) : null}
              <SectionTitle>Filter Effects</SectionTitle>
              <SegmentedControl onChange={(value) => updateTrackState('filter', value)} options={REGION_FILTERS.map((filter) => ({ label: filter.label, value: filter.id }))} value={trackState.filter} />
              <SectionTitle>Connections</SectionTitle>
              <SegmentedControl onChange={(value) => updateTrackState('connectionStyle', value)} options={[{ label: 'Dashed', value: 'dashed' }, { label: 'Solid', value: 'solid' }, { label: 'Dotted', value: 'dotted' }]} value={trackState.connectionStyle} />
              <SliderControl label="Connection Rate" max={100} min={10} onChange={(value) => updateTrackState('connectionRate', value)} value={trackState.connectionRate} />
            </>
          ) : null}
        </div>

        {effectId === 'img-track' && visibleTrackedRegions.length > 0 ? (
          <div className="sidebar-block">
            <SectionTitle>Tracked Regions ({visibleTrackedRegions.length})</SectionTitle>
            <div className="region-list">
              {visibleTrackedRegions.map((region) => (
                <div key={region.id} className="region-row region-row-static">
                  <span>{region.label}</span>
                  <span>{region.trackingSource} · {Math.round((region.confidence ?? 0) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {effectId === 'img-track' && regions.length > 0 ? (
          <div className="sidebar-block">
            <SectionTitle>Manual Regions ({regions.length})</SectionTitle>
            <div className="region-list">
              {regions.map((region) => (
                <button key={region.id} className={`region-row ${region.id === selectedRegionId ? 'is-active' : ''}`} onClick={() => selectRegion(region.id)} type="button">
                  <span>{region.label}</span>
                  <span>{region.shape} · {getRegionStyleLabel(region.style)}</span>
                </button>
              ))}
            </div>
            <div className="region-actions">
              <button className="button button-danger" onClick={removeSelectedRegion} type="button">
                Remove
              </button>
              <button className="button button-muted" onClick={clearRegions} type="button">
                Clear All
              </button>
            </div>
          </div>
        ) : null}
      </aside>

      <main className="preview-shell">
        <div className="preview-toolbar">
          <div className="preview-meta">
            <span>{hasSource ? 'Canvas ready' : 'Waiting for source'}</span>
            <span>
              {sourceKind === 'model'
                ? 'Drag to orbit the model.'
                : sourceKind === 'webcam'
                  ? webcamInfo.ready
                    ? effectId === 'img-track' && trackState.trackingMode !== 'manual'
                      ? `${webcamInfo.width} × ${webcamInfo.height} live · ${trackingDescriptor}`
                      : `${webcamInfo.width} × ${webcamInfo.height} live`
                    : 'Waiting for webcam access.'
                : image
                  ? `${image.width} × ${image.height}`
                  : 'Upload an image, upload a 3D model, or use your webcam.'}
            </span>
          </div>
          <button className="button button-muted" onClick={() => setFitMode((current) => (current === 'contain' ? 'cover' : 'contain'))} type="button">
            {fitMode === 'contain' ? 'Fill' : 'Fit'}
          </button>
        </div>

        <div className="preview-frame" ref={previewFrameRef}>
          {!hasSource ? (
            <div className="empty-state">
              <p>No source loaded</p>
              <span>Upload an image, upload a 3D file, or start your webcam.</span>
            </div>
          ) : null}

          <canvas
            className={`preview-canvas is-${fitMode}`}
            onMouseDown={handlePointerDown}
            onMouseLeave={handlePointerUp}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            ref={canvasRef}
          />
        </div>
      </main>
    </div>
  )
}

export default App
