import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'

const DEFAULT_DISTANCE = 3.4

const getExtension = (fileName) => fileName.split('.').pop()?.toLowerCase() ?? ''

const fitCameraToObject = (camera, controls, root, orbitState) => {
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxSize = Math.max(size.x, size.y, size.z) || 1
  const distance = maxSize * 1.8
  orbitState.distance = Math.max(distance, DEFAULT_DISTANCE)
  controls.target.copy(center)
  camera.near = Math.max(0.01, maxSize / 100)
  camera.far = Math.max(100, maxSize * 20)
  camera.updateProjectionMatrix()
}

const applyMaterialOverrides = (root, config) => {
  root.traverse((child) => {
    if (!child.isMesh) {
      return
    }

    if (!child.material) {
      child.material = new THREE.MeshStandardMaterial({ color: 0xe5e2d8 })
    }

    if (Array.isArray(child.material)) {
      child.material.forEach((material) => {
        material.wireframe = config.wireframe
      })
      return
    }

    child.material.wireframe = config.wireframe
    if (!child.material.color) {
      child.material.color = new THREE.Color(0xe5e2d8)
    }
  })
}

const updateModelTransform = (root, config) => {
  root.scale.setScalar(config.scale)
  root.rotation.set(
    (config.rotationX * Math.PI) / 180,
    (config.rotationY * Math.PI) / 180,
    (config.rotationZ * Math.PI) / 180,
  )
  root.position.set(config.positionX, config.positionY, config.positionZ)
}

export const createModelViewer = () => {
  const renderCanvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    canvas: renderCanvas,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25))
  renderer.shadowMap.enabled = false
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500)
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.2)
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.8)
  const rimLight = new THREE.DirectionalLight(0x88bbff, 1.3)
  keyLight.position.set(4.5, 5.5, 6)
  rimLight.position.set(-5, 3, -4)
  scene.add(ambientLight, keyLight, rimLight)

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4, 64),
    new THREE.MeshStandardMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.55,
      roughness: 0.88,
      metalness: 0.02,
    }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -1.25
  scene.add(floor)

  const controls = {
    target: new THREE.Vector3(),
    orbit: {
      yaw: 0.6,
      pitch: 0.25,
      distance: DEFAULT_DISTANCE,
    },
    drag: {
      active: false,
      x: 0,
      y: 0,
    },
  }

  let modelRoot = null
  let viewportWidth = 0
  let viewportHeight = 0
  let lastMaterialSignature = ''
  let lastTransformSignature = ''
  let lastEnvironmentSignature = ''

  const updateCamera = () => {
    const { yaw, pitch, distance } = controls.orbit
    const safePitch = Math.max(-1.4, Math.min(1.4, pitch))
    camera.position.set(
      controls.target.x + Math.cos(safePitch) * Math.sin(yaw) * distance,
      controls.target.y + Math.sin(safePitch) * distance,
      controls.target.z + Math.cos(safePitch) * Math.cos(yaw) * distance,
    )
    camera.lookAt(controls.target)
  }

  const setViewport = (width, height) => {
    if (viewportWidth === width && viewportHeight === height) {
      return
    }
    viewportWidth = width
    viewportHeight = height
    renderer.setSize(width, height, false)
    camera.aspect = width / Math.max(height, 1)
    camera.updateProjectionMatrix()
  }

  const setBackground = (color) => {
    scene.background = new THREE.Color(color)
  }

  const updateEnvironment = (config) => {
    const environmentSignature = [config.ambientIntensity, config.lightIntensity, config.exposure, config.background].join('|')
    ambientLight.intensity = config.ambientIntensity
    keyLight.intensity = config.lightIntensity
    rimLight.intensity = config.lightIntensity * 0.45
    renderer.toneMappingExposure = config.exposure
    if (environmentSignature !== lastEnvironmentSignature) {
      setBackground(config.background)
      lastEnvironmentSignature = environmentSignature
    }

    if (modelRoot) {
      const materialSignature = `${config.wireframe}`
      if (materialSignature !== lastMaterialSignature) {
        applyMaterialOverrides(modelRoot, config)
        lastMaterialSignature = materialSignature
      }

      const transformSignature = [
        config.scale,
        config.rotationX,
        config.rotationY,
        config.rotationZ,
        config.positionX,
        config.positionY,
        config.positionZ,
      ].join('|')
      if (transformSignature !== lastTransformSignature) {
        updateModelTransform(modelRoot, config)
        lastTransformSignature = transformSignature
      }
    }
  }

  const loadModel = async (file, config) => {
    const extension = getExtension(file.name)
    const objectUrl = URL.createObjectURL(file)

    try {
      let root
      if (extension === 'obj') {
        root = await new Promise((resolve, reject) => {
          new OBJLoader().load(objectUrl, resolve, undefined, reject)
        })
      } else if (extension === 'gltf' || extension === 'glb') {
        const gltf = await new Promise((resolve, reject) => {
          new GLTFLoader().load(objectUrl, resolve, undefined, reject)
        })
        root = gltf.scene
      } else {
        throw new Error('Unsupported 3D format. Use OBJ, GLTF, or GLB.')
      }

      if (modelRoot) {
        scene.remove(modelRoot)
      }

      modelRoot = root
      modelRoot.traverse((child) => {
        if (child.isMesh && !child.material) {
          child.material = new THREE.MeshStandardMaterial({ color: 0xe5e2d8 })
        }
      })
      scene.add(modelRoot)
      lastMaterialSignature = ''
      lastTransformSignature = ''
      lastEnvironmentSignature = ''
      updateEnvironment(config)
      fitCameraToObject(camera, controls, modelRoot, controls.orbit)
      updateCamera()
      return root
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  const render = (config) => {
    if (modelRoot && config.autoRotate) {
      controls.orbit.yaw += 0.006
    }
    updateEnvironment(config)
    updateCamera()
    renderer.render(scene, camera)
    return renderCanvas
  }

  const onPointerDown = (event) => {
    controls.drag.active = true
    controls.drag.x = event.clientX
    controls.drag.y = event.clientY
  }

  const onPointerMove = (event) => {
    if (!controls.drag.active) {
      return
    }
    const deltaX = event.clientX - controls.drag.x
    const deltaY = event.clientY - controls.drag.y
    controls.drag.x = event.clientX
    controls.drag.y = event.clientY
    controls.orbit.yaw -= deltaX * 0.01
    controls.orbit.pitch -= deltaY * 0.01
  }

  const onPointerUp = () => {
    controls.drag.active = false
  }

  const isDragging = () => controls.drag.active

  const dispose = () => {
    renderer.dispose()
    scene.traverse((child) => {
      if (child.geometry) {
        child.geometry.dispose()
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose())
        } else {
          child.material.dispose()
        }
      }
    })
  }

  return {
    camera,
    dispose,
    loadModel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    isDragging,
    render,
    renderCanvas,
    setViewport,
  }
}
