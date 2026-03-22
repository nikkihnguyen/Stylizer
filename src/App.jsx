import { useEffect, useRef, useState } from 'react'
import './App.css'
import {
  DEFAULT_SETTINGS,
  EFFECTS,
  EMPTY_REGION_STYLE,
  REGION_FILTERS,
  REGION_STYLES,
} from './config'
import { drawDraftRegion, getRegionStyleLabel, makeRegionLabel, renderEffect } from './effects'

const PANEL_COLOR_EFFECTS = new Set(['half-tone', 'retroman'])

const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULT_SETTINGS))

const buildInitialTrackState = () => ({
  shape: EMPTY_REGION_STYLE.shape,
  style: EMPTY_REGION_STYLE.style,
  filter: EMPTY_REGION_STYLE.filter,
  connectionStyle: EMPTY_REGION_STYLE.connectionStyle,
  connectionRate: EMPTY_REGION_STYLE.connectionRate,
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
  const [regions, setRegions] = useState([])
  const [selectedRegionId, setSelectedRegionId] = useState(null)
  const [draftRegion, setDraftRegion] = useState(null)
  const [drawing, setDrawing] = useState(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [image, setImage] = useState(null)
  const [error, setError] = useState('')
  const [fitMode, setFitMode] = useState('contain')

  const canvasRef = useRef(null)

  useEffect(() => {
    if (!sourceUrl) {
      return
    }

    const nextImage = new Image()
    nextImage.onload = () => setImage(nextImage)
    nextImage.onerror = () => setError('Unable to load that image.')
    nextImage.src = sourceUrl
    return () => {
      nextImage.onload = null
      nextImage.onerror = null
    }
  }, [sourceUrl])

  useEffect(() => {
    if (!image || !canvasRef.current) {
      return
    }

    const canvas = canvasRef.current
    canvas.width = image.naturalWidth || image.width
    canvas.height = image.naturalHeight || image.height
    const context = canvas.getContext('2d', { willReadFrequently: true })

    let frame = 0
    const paint = (time) => {
      renderEffect({
        context,
        image,
        effectId,
        settings: settings[effectId],
        width: canvas.width,
        height: canvas.height,
        regions,
        selectedRegionId,
        connectionStyle: trackState.connectionStyle,
        connectionRate: trackState.connectionRate,
        now: time / 1000,
      })
      if (effectId === 'img-track' && draftRegion) {
        drawDraftRegion(context, draftRegion)
      }
      if (effectId === 'ascii-kit' && settings['ascii-kit'].animated) {
        frame = requestAnimationFrame(paint)
      }
    }

    paint(0)
    if (effectId === 'ascii-kit' && settings['ascii-kit'].animated) {
      frame = requestAnimationFrame(paint)
    }

    return () => {
      if (frame) {
        cancelAnimationFrame(frame)
      }
    }
  }, [draftRegion, effectId, image, regions, selectedRegionId, settings, trackState])

  const currentEffect = EFFECTS.find((effect) => effect.id === effectId)
  const currentSettings = settings[effectId]
  const showStandaloneColor =
    PANEL_COLOR_EFFECTS.has(effectId) || (effectId === 'ascii-kit' && currentSettings.colorMode === 'mono')

  const updateSetting = (key, value) => {
    setSettings((current) => ({
      ...current,
      [effectId]: {
        ...current[effectId],
        [key]: value,
      },
    }))
  }

  const updateTrackState = (key, value) => {
    setTrackState((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const handleUpload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      setError('This build currently supports image files only.')
      return
    }

    setError('')
    setImage(null)
    const nextUrl = await readFileAsUrl(file)
    setSourceUrl(nextUrl)
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
    const scaleX = canvas.width / bounds.width
    const scaleY = canvas.height / bounds.height
    return {
      x: (event.clientX - bounds.left) * scaleX,
      y: (event.clientY - bounds.top) * scaleY,
    }
  }

  const handlePointerDown = (event) => {
    if (effectId !== 'img-track' || !image) {
      return
    }
    event.preventDefault()
    const point = pointerToCanvasPoint(event)
    setDrawing(point)
    setDraftRegion({
      id: 'draft',
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
      shape: trackState.shape,
      style: trackState.style,
      filter: trackState.filter,
      label: 'Draft',
    })
  }

  const handlePointerMove = (event) => {
    if (!drawing || effectId !== 'img-track') {
      return
    }
    event.preventDefault()
    const point = pointerToCanvasPoint(event)
    const x = Math.min(point.x, drawing.x)
    const y = Math.min(point.y, drawing.y)
    const width = Math.abs(point.x - drawing.x)
    const height = Math.abs(point.y - drawing.y)
    setDraftRegion({
      id: 'draft',
      x,
      y,
      width,
      height,
      shape: trackState.shape,
      style: trackState.style,
      filter: trackState.filter,
      label: 'Draft',
    })
  }

  const handlePointerUp = () => {
    if (!drawing || !draftRegion) {
      return
    }

    if (draftRegion.width > 12 && draftRegion.height > 12) {
      const nextRegion = {
        id: crypto.randomUUID(),
        x: draftRegion.x,
        y: draftRegion.y,
        width: draftRegion.width,
        height: draftRegion.height,
        shape: trackState.shape,
        style: trackState.style,
        filter: trackState.filter,
        label: makeRegionLabel(regions.length),
      }
      setRegions((current) => [...current, nextRegion])
      setSelectedRegionId(nextRegion.id)
    }

    setDrawing(null)
    setDraftRegion(null)
  }

  const removeSelectedRegion = () => {
    if (!selectedRegionId) {
      return
    }
    setRegions((current) => current.filter((region) => region.id !== selectedRegionId))
    setSelectedRegionId(null)
  }

  const clearRegions = () => {
    setRegions([])
    setSelectedRegionId(null)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-block top-bar">
          <div>
            <p className="eyebrow">Stylizer Lab</p>
            <h1>Image Effects Editor</h1>
            <p className="lede">{currentEffect?.description}</p>
          </div>
          <button className="button button-ghost" onClick={exportPng} type="button">
            Export
          </button>
        </div>

        <div className="sidebar-block">
          <SectionTitle>Source</SectionTitle>
          <label className="upload-card">
            <span>Upload image</span>
            <input accept="image/*" onChange={handleUpload} type="file" />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
        </div>

        <div className="sidebar-block">
          <SectionTitle>Effect</SectionTitle>
          <div className="effect-grid">
            {EFFECTS.map((effect) => (
              <button
                key={effect.id}
                className={`effect-button ${effect.id === effectId ? 'is-active' : ''}`}
                onClick={() => setEffectId(effect.id)}
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
                <ToggleControl
                  checked={currentSettings.gradientMask}
                  label="Gradient Mask"
                  onChange={(value) => updateSetting('gradientMask', value)}
                />
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
              <SegmentedControl
                onChange={(value) => updateSetting('colorMode', value)}
                options={[
                  { label: 'CMYK', value: 'cmyk' },
                  { label: 'RGB', value: 'rgb' },
                ]}
                value={currentSettings.colorMode}
              />
              <SliderControl label="Dot Size" max={24} min={2} onChange={(value) => updateSetting('dotSize', value)} value={currentSettings.dotSize} />
              <SliderControl label="Mix" max={100} min={0} onChange={(value) => updateSetting('mix', value)} value={currentSettings.mix} />
              <SliderControl label="Brightness" max={100} min={-100} onChange={(value) => updateSetting('brightness', value)} value={currentSettings.brightness} />
              <SliderControl label="Contrast" max={100} min={-100} onChange={(value) => updateSetting('contrast', value)} value={currentSettings.contrast} />
              <SectionTitle>Background</SectionTitle>
              <SegmentedControl
                onChange={(value) => updateSetting('background', value)}
                options={[
                  { label: 'White', value: '#ffffff' },
                  { label: 'Black', value: '#000000' },
                  { label: 'Paper', value: '#f5f0e8' },
                ]}
                value={currentSettings.background}
              />
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
              <SegmentedControl
                onChange={(value) => updateSetting('renderMode', value)}
                options={[
                  { label: 'Brightness', value: 'brightness' },
                  { label: 'Edges', value: 'edges' },
                ]}
                value={currentSettings.renderMode}
              />
              <SectionTitle>Character Set</SectionTitle>
              <SegmentedControl
                onChange={(value) => updateSetting('charset', value)}
                options={[
                  { label: 'Dense', value: 'dense' },
                  { label: 'Classic', value: 'classic' },
                  { label: 'Blocks', value: 'blocks' },
                  { label: 'Binary', value: 'binary' },
                  { label: 'Minimal', value: 'minimal' },
                  { label: 'Retro', value: 'retro' },
                ]}
                value={currentSettings.charset}
              />
              <SliderControl label="Font Size" max={28} min={6} onChange={(value) => updateSetting('fontSize', value)} step={2} value={currentSettings.fontSize} />
              <SliderControl label="Coverage" max={100} min={10} onChange={(value) => updateSetting('coverage', value)} value={currentSettings.coverage} />
              <SliderControl label="Edge Emphasis" max={100} min={0} onChange={(value) => updateSetting('edgeEmphasis', value)} value={currentSettings.edgeEmphasis} />
              <SectionTitle>Background</SectionTitle>
              <SegmentedControl
                onChange={(value) => updateSetting('bgMode', value)}
                options={[
                  { label: 'Blurred', value: 'blurred' },
                  { label: 'Original', value: 'original' },
                  { label: 'Black', value: 'black' },
                ]}
                value={currentSettings.bgMode}
              />
              {currentSettings.bgMode === 'blurred' ? (
                <SliderControl label="Blur" max={50} min={0} onChange={(value) => updateSetting('bgBlur', value)} value={currentSettings.bgBlur} />
              ) : null}
              {currentSettings.bgMode !== 'black' ? (
                <SliderControl label="Opacity" max={100} min={0} onChange={(value) => updateSetting('bgOpacity', value)} value={currentSettings.bgOpacity} />
              ) : null}
              <SectionTitle>Color & Tone</SectionTitle>
              <SegmentedControl
                onChange={(value) => updateSetting('colorMode', value)}
                options={[
                  { label: 'True Color', value: 'color' },
                  { label: 'Custom', value: 'mono' },
                ]}
                value={currentSettings.colorMode}
              />
              {currentSettings.colorMode === 'mono' ? (
                <ColorControl label="Color" onChange={(value) => updateSetting('color', value)} value={currentSettings.color} />
              ) : null}
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

          {effectId === 'image-track' ? (
            <SliderControl label="Strength" max={100} min={0} onChange={(value) => updateSetting('strength', value)} value={currentSettings.strength} />
          ) : null}

          {effectId === 'half-tone' ? (
            <SliderControl label="Dot Size" max={20} min={2} onChange={(value) => updateSetting('dotSize', value)} value={currentSettings.dotSize} />
          ) : null}

          {effectId === 'retroman' ? (
            <SliderControl label="Pixel Scale" max={8} min={1} onChange={(value) => updateSetting('scale', value)} value={currentSettings.scale} />
          ) : null}

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
              <SectionTitle>Shape</SectionTitle>
              <SegmentedControl
                onChange={(value) => updateTrackState('shape', value)}
                options={[
                  { label: 'Rectangle', value: 'rectangle' },
                  { label: 'Circle', value: 'circle' },
                  { label: 'Ellipse', value: 'ellipse' },
                ]}
                value={trackState.shape}
              />
              <SectionTitle>Region Style</SectionTitle>
              <SegmentedControl
                onChange={(value) => updateTrackState('style', value)}
                options={REGION_STYLES.map((style) => ({ label: style.label, value: style.id }))}
                value={trackState.style}
              />
              <SectionTitle>Filter Effects</SectionTitle>
              <SegmentedControl
                onChange={(value) => updateTrackState('filter', value)}
                options={REGION_FILTERS.map((filter) => ({ label: filter.label, value: filter.id }))}
                value={trackState.filter}
              />
              <SectionTitle>Connections</SectionTitle>
              <SegmentedControl
                onChange={(value) => updateTrackState('connectionStyle', value)}
                options={[
                  { label: 'Dashed', value: 'dashed' },
                  { label: 'Solid', value: 'solid' },
                  { label: 'Dotted', value: 'dotted' },
                ]}
                value={trackState.connectionStyle}
              />
              <SliderControl label="Connection Rate" max={100} min={10} onChange={(value) => updateTrackState('connectionRate', value)} value={trackState.connectionRate} />
            </>
          ) : null}
        </div>

        {effectId === 'img-track' && regions.length > 0 ? (
          <div className="sidebar-block">
            <SectionTitle>Regions ({regions.length})</SectionTitle>
            <div className="region-list">
              {regions.map((region) => (
                <button
                  key={region.id}
                  className={`region-row ${region.id === selectedRegionId ? 'is-active' : ''}`}
                  onClick={() => setSelectedRegionId(region.id)}
                  type="button"
                >
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
            <span>{image ? 'Canvas ready' : 'Waiting for source image'}</span>
            <span>{image ? `${image.width} × ${image.height}` : 'Upload a PNG or JPG to start'}</span>
          </div>
          <button className="button button-muted" onClick={() => setFitMode((current) => (current === 'contain' ? 'cover' : 'contain'))} type="button">
            {fitMode === 'contain' ? 'Fill' : 'Fit'}
          </button>
        </div>

        <div className="preview-frame">
          {image ? null : (
            <div className="empty-state">
              <p>No image loaded</p>
              <span>Use Upload image to start rendering effects.</span>
            </div>
          )}

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
