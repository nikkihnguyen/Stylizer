const MEDIAPIPE_VERSION = '0.10.33'
const MEDIAPIPE_MODULE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`
const MEDIAPIPE_WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
const FACE_MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
const HAND_MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

const TRACKING_FRAME_MAX_DIMENSION = 320
const HAND_FINGER_GROUPS = [
  { id: 'thumb', label: 'Thumb', landmarkIndexes: [1, 2, 3, 4] },
  { id: 'index', label: 'Index', landmarkIndexes: [5, 6, 7, 8] },
  { id: 'middle', label: 'Middle', landmarkIndexes: [9, 10, 11, 12] },
  { id: 'ring', label: 'Ring', landmarkIndexes: [13, 14, 15, 16] },
  { id: 'pinky', label: 'Pinky', landmarkIndexes: [17, 18, 19, 20] },
]

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const lerp = (start, end, alpha) => start + (end - start) * alpha
const modeUsesFace = (mode) => mode === 'face' || mode === 'hands-face'
const modeUsesHands = (mode) => mode === 'hands' || mode === 'hands-face'
const distanceBetween = (left, right) => Math.hypot(left.x - right.x, left.y - right.y)

const padBounds = (region, frameWidth, frameHeight, paddingScale) => {
  const paddingX = region.width * paddingScale
  const paddingY = region.height * paddingScale
  const x = clamp(region.x - paddingX, 0, Math.max(0, frameWidth - 1))
  const y = clamp(region.y - paddingY, 0, Math.max(0, frameHeight - 1))
  const width = clamp(region.width + paddingX * 2, 1, Math.max(1, frameWidth - x))
  const height = clamp(region.height + paddingY * 2, 1, Math.max(1, frameHeight - y))

  return {
    ...region,
    height,
    width,
    x,
    y,
  }
}

const smoothRegionGeometry = (currentRegion, previousRegion, smoothing) => {
  if (!previousRegion) {
    return currentRegion
  }

  const blend = clamp(1 - smoothing * 0.72, 0.18, 1)
  return {
    ...currentRegion,
    height: lerp(previousRegion.height, currentRegion.height, blend),
    width: lerp(previousRegion.width, currentRegion.width, blend),
    x: lerp(previousRegion.x, currentRegion.x, blend),
    y: lerp(previousRegion.y, currentRegion.y, blend),
  }
}

const buildHandRegionFromLandmarks = (landmarks, width, height, id, label, confidence) => {
  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0

  for (const landmark of landmarks) {
    minX = Math.min(minX, landmark.x)
    minY = Math.min(minY, landmark.y)
    maxX = Math.max(maxX, landmark.x)
    maxY = Math.max(maxY, landmark.y)
  }

  return padBounds(
    {
      confidence,
      id,
      kind: 'tracked',
      label,
      trackingSource: 'hand',
      x: minX * width,
      y: minY * height,
      width: Math.max(1, (maxX - minX) * width),
      height: Math.max(1, (maxY - minY) * height),
    },
    width,
    height,
    0.24,
  )
}

const buildFingerRegionFromLandmarks = (
  landmarks,
  width,
  height,
  finger,
  handedness,
  confidence,
  paddingScale,
) => {
  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0

  for (const landmarkIndex of finger.landmarkIndexes) {
    const landmark = landmarks[landmarkIndex]
    if (!landmark) {
      continue
    }
    minX = Math.min(minX, landmark.x)
    minY = Math.min(minY, landmark.y)
    maxX = Math.max(maxX, landmark.x)
    maxY = Math.max(maxY, landmark.y)
  }

  return padBounds(
    {
      confidence,
      id: `tracked-${handedness.toLowerCase()}-${finger.id}`,
      kind: 'tracked',
      label: `${handedness === 'Hand' ? '' : `${handedness} `}${finger.label}`.trim(),
      trackingSource: 'finger',
      x: minX * width,
      y: minY * height,
      width: Math.max(1, (maxX - minX) * width),
      height: Math.max(1, (maxY - minY) * height),
    },
    width,
    height,
    paddingScale,
  )
}

const buildPinchGesture = (landmarks, handedness, confidence) => {
  const thumbTip = landmarks[4]
  const indexTip = landmarks[8]
  if (!thumbTip || !indexTip) {
    return null
  }

  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0
  for (const landmark of landmarks) {
    minX = Math.min(minX, landmark.x)
    minY = Math.min(minY, landmark.y)
    maxX = Math.max(maxX, landmark.x)
    maxY = Math.max(maxY, landmark.y)
  }

  const handSpan = Math.max(0.001, Math.max(maxX - minX, maxY - minY))
  return {
    confidence,
    detected: true,
    handedness,
    ratio: distanceBetween(thumbTip, indexTip) / handSpan,
  }
}

const regionSort = (left, right) => left.x - right.x

export const TRACKING_MODE_OPTIONS = [
  { label: 'Manual', value: 'manual' },
  { label: 'Hands', value: 'hands' },
  { label: 'Face', value: 'face' },
  { label: 'Hands + Face', value: 'hands-face' },
]

export const getTrackingModeLabel = (mode) =>
  TRACKING_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode

export const createWebcamTracker = async () => {
  const { FaceDetector, FilesetResolver, HandLandmarker } = await import(
    /* @vite-ignore */
    MEDIAPIPE_MODULE_URL
  )

  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT)
  const processingCanvas = document.createElement('canvas')
  const processingContext = processingCanvas.getContext('2d', { willReadFrequently: true })
  if (!processingContext) {
    throw new Error('Tracking canvas unavailable in this browser.')
  }
  const smoothedRegionsById = new Map()

  let faceDetector = null
  let handLandmarker = null

  const ensureProcessingFrame = (video) => {
    const sourceWidth = Math.max(1, video.videoWidth || video.width || 1)
    const sourceHeight = Math.max(1, video.videoHeight || video.height || 1)
    const scale = Math.min(1, TRACKING_FRAME_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))

    if (processingCanvas.width !== width || processingCanvas.height !== height) {
      processingCanvas.width = width
      processingCanvas.height = height
    }

    processingContext.clearRect(0, 0, width, height)
    processingContext.drawImage(video, 0, 0, width, height)

    return {
      frame: processingCanvas,
      frameHeight: sourceHeight,
      frameWidth: sourceWidth,
      scaleX: sourceWidth / width,
      scaleY: sourceHeight / height,
    }
  }

  const ensureFaceDetector = async (minConfidence) => {
    const options = {
      baseOptions: {
        modelAssetPath: FACE_MODEL_ASSET_PATH,
      },
      minDetectionConfidence: minConfidence,
      minSuppressionThreshold: 0.35,
      runningMode: 'VIDEO',
    }

    if (faceDetector) {
      await faceDetector.setOptions(options)
      return faceDetector
    }

    faceDetector = await FaceDetector.createFromOptions(vision, options)
    return faceDetector
  }

  const ensureHandLandmarker = async (minConfidence) => {
    const options = {
      baseOptions: {
        modelAssetPath: HAND_MODEL_ASSET_PATH,
      },
      minHandDetectionConfidence: minConfidence,
      minHandPresenceConfidence: minConfidence,
      minTrackingConfidence: Math.max(0.35, minConfidence - 0.1),
      numHands: 2,
      runningMode: 'VIDEO',
    }

    if (handLandmarker) {
      await handLandmarker.setOptions(options)
      return handLandmarker
    }

    handLandmarker = await HandLandmarker.createFromOptions(vision, options)
    return handLandmarker
  }

  return {
    async ensure({ minConfidence, mode }) {
      if (modeUsesFace(mode)) {
        await ensureFaceDetector(minConfidence)
      }

      if (modeUsesHands(mode)) {
        await ensureHandLandmarker(minConfidence)
      }
    },

    detect(video, timestamp, { fingerPadding, minConfidence, mode, smoothing, trackFingers }) {
      const { frame, frameHeight, frameWidth, scaleX, scaleY } = ensureProcessingFrame(video)
      const nextRegions = []
      let bestPinch = null

      if (modeUsesFace(mode) && faceDetector) {
        const faceResult = faceDetector.detectForVideo(frame, timestamp)
        const detections = [...(faceResult.detections ?? [])].sort(
          (left, right) => left.boundingBox.originX - right.boundingBox.originX,
        )

        detections.forEach((detection, index) => {
          const confidence = detection.categories?.[0]?.score ?? 0
          if (confidence < minConfidence) {
            return
          }

          nextRegions.push(
            padBounds(
              {
                confidence,
                id: `tracked-face-${index + 1}`,
                kind: 'tracked',
                label: `Face ${index + 1}`,
                trackingSource: 'face',
                x: detection.boundingBox.originX * scaleX,
                y: detection.boundingBox.originY * scaleY,
                width: Math.max(1, detection.boundingBox.width * scaleX),
                height: Math.max(1, detection.boundingBox.height * scaleY),
              },
              frameWidth,
              frameHeight,
              0.14,
            ),
          )
        })
      }

      if (modeUsesHands(mode) && handLandmarker) {
        const handResult = handLandmarker.detectForVideo(frame, timestamp)
        const hands = handResult.landmarks.map((landmarks, index) => ({
          confidence: handResult.handedness?.[index]?.[0]?.score ?? 0,
          handedness: handResult.handedness?.[index]?.[0]?.displayName
            || handResult.handedness?.[index]?.[0]?.categoryName
            || 'Hand',
          landmarks,
        }))

        const handCounts = new Map()
        hands.sort((left, right) => {
          const leftMidpoint = left.landmarks.reduce((total, landmark) => total + landmark.x, 0) / left.landmarks.length
          const rightMidpoint = right.landmarks.reduce((total, landmark) => total + landmark.x, 0) / right.landmarks.length
          return leftMidpoint - rightMidpoint
        })

        hands.forEach((hand) => {
          if (hand.confidence < minConfidence) {
            return
          }

          const handedness = hand.handedness === 'Left' || hand.handedness === 'Right'
            ? hand.handedness
            : 'Hand'
          const count = (handCounts.get(handedness) ?? 0) + 1
          handCounts.set(handedness, count)
          const pinchGesture = buildPinchGesture(hand.landmarks, handedness, hand.confidence)
          if (pinchGesture && (!bestPinch || pinchGesture.confidence >= bestPinch.confidence)) {
            bestPinch = pinchGesture
          }

          nextRegions.push(
            buildHandRegionFromLandmarks(
              hand.landmarks,
              frameWidth,
              frameHeight,
              `tracked-${handedness.toLowerCase()}-${count}`,
              handedness === 'Hand' ? `Hand ${count}` : `${handedness} Hand`,
              hand.confidence,
            ),
          )

          if (trackFingers) {
            HAND_FINGER_GROUPS.forEach((finger) => {
              nextRegions.push(
                buildFingerRegionFromLandmarks(
                  hand.landmarks,
                  frameWidth,
                  frameHeight,
                  finger,
                  handedness,
                  hand.confidence,
                  fingerPadding / 100,
                ),
              )
            })
          }
        })
      }

      nextRegions.sort(regionSort)

      const nextSmoothedRegions = nextRegions.map((region) =>
        smoothRegionGeometry(region, smoothedRegionsById.get(region.id), smoothing),
      )

      smoothedRegionsById.clear()
      nextSmoothedRegions.forEach((region) => {
        smoothedRegionsById.set(region.id, region)
      })

      return {
        pinch: bestPinch,
        regions: nextSmoothedRegions,
      }
    },

    close() {
      faceDetector?.close()
      handLandmarker?.close()
      faceDetector = null
      handLandmarker = null
      smoothedRegionsById.clear()
    },
  }
}
