import { ASCII_CHARSETS, REGION_STYLES } from './config'

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const luminance = (r, g, b) => r * 0.299 + g * 0.587 + b * 0.114

const copyCanvas = (width, height, source) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(source, 0, 0, width, height)
  return { canvas, context }
}

const applyBrightnessContrast = (context, width, height, brightness = 0, contrast = 0) => {
  if (brightness === 0 && contrast === 0) {
    return
  }
  const imageData = context.getImageData(0, 0, width, height)
  const { data } = imageData
  const offset = (brightness / 100) * 128
  const multiplier = contrast >= 0 ? 1 + contrast / 100 : 1 / (1 - contrast / 100)

  for (let index = 0; index < data.length; index += 4) {
    data[index] = clamp((data[index] + offset - 128) * multiplier + 128, 0, 255)
    data[index + 1] = clamp((data[index + 1] + offset - 128) * multiplier + 128, 0, 255)
    data[index + 2] = clamp((data[index + 2] + offset - 128) * multiplier + 128, 0, 255)
  }

  context.putImageData(imageData, 0, 0)
}

const computeEdges = (data, width, height) => {
  const grayscale = new Float32Array(width * height)
  for (let index = 0; index < width * height; index += 1) {
    const base = index * 4
    grayscale[index] = luminance(data[base], data[base + 1], data[base + 2]) / 255
  }

  const edges = new Float32Array(width * height)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const topLeft = grayscale[(y - 1) * width + (x - 1)]
      const top = grayscale[(y - 1) * width + x]
      const topRight = grayscale[(y - 1) * width + (x + 1)]
      const left = grayscale[y * width + (x - 1)]
      const right = grayscale[y * width + (x + 1)]
      const bottomLeft = grayscale[(y + 1) * width + (x - 1)]
      const bottom = grayscale[(y + 1) * width + x]
      const bottomRight = grayscale[(y + 1) * width + (x + 1)]

      const gradientX = -topLeft - 2 * left - bottomLeft + topRight + 2 * right + bottomRight
      const gradientY = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight
      edges[y * width + x] = clamp(Math.sqrt(gradientX * gradientX + gradientY * gradientY), 0, 1)
    }
  }
  return edges
}

const renderAsciiLayer = (source, width, height, settings, now) => {
  const { context } = copyCanvas(width, height, source)
  const sourceData = context.getImageData(0, 0, width, height).data
  const edges = computeEdges(sourceData, width, height)

  const bgCanvas = document.createElement('canvas')
  bgCanvas.width = width
  bgCanvas.height = height
  const bgContext = bgCanvas.getContext('2d')

  const backgroundMode = settings.bgMode ?? 'blurred'
  const backgroundOpacity = (settings.bgOpacity ?? 100) / 100
  if (backgroundMode === 'black') {
    bgContext.fillStyle = '#000'
    bgContext.fillRect(0, 0, width, height)
  } else if (backgroundMode === 'original') {
    bgContext.globalAlpha = backgroundOpacity
    bgContext.drawImage(source, 0, 0, width, height)
    bgContext.globalAlpha = 1
  } else {
    const blurCanvas = document.createElement('canvas')
    blurCanvas.width = width
    blurCanvas.height = height
    const blurContext = blurCanvas.getContext('2d')
    const blur = settings.bgBlur ?? 20
    blurContext.filter = `blur(${blur}px)`
    blurContext.drawImage(source, -blur * 2, -blur * 2, width + blur * 4, height + blur * 4)
    blurContext.filter = 'none'
    bgContext.globalAlpha = backgroundOpacity
    bgContext.drawImage(blurCanvas, 0, 0)
    bgContext.globalAlpha = 1
  }

  const fontSize = Math.max(5, settings.fontSize ?? 10)
  const cellWidth = fontSize * 0.62
  const cellHeight = fontSize * 1.15
  const charset = ASCII_CHARSETS[settings.charset] ?? ASCII_CHARSETS.dense
  const coverage = (settings.coverage ?? 100) / 100
  const edgeWeight = (settings.edgeEmphasis ?? 60) / 100
  const invertMapping = settings.invertMapping ?? false
  const useColor = (settings.colorMode ?? 'color') === 'color'
  const customColor = settings.color ?? '#f7f7f2'
  const charBrightness = settings.charBrightness ?? 0
  const charContrast = settings.charContrast ?? 0
  const charOffset = (charBrightness / 100) * 128
  const charMultiplier = charContrast >= 0 ? 1 + charContrast / 100 : 1 / (1 - charContrast / 100)
  const charOpacity = (settings.charOpacity ?? 75) / 100
  const animated = settings.animated ?? false
  const animIntensity = (settings.animIntensity ?? 60) / 100
  const animRandomness = (settings.animRandomness ?? 50) / 100
  const animSpeed = Math.max(0.1, settings.animSpeed ?? 1.5)

  const glyphs = []
  for (let y = 0; y < height; y += cellHeight) {
    for (let x = 0; x < width; x += cellWidth) {
      const sampleX = clamp(Math.floor(x + cellWidth / 2), 0, width - 1)
      const sampleY = clamp(Math.floor(y + cellHeight / 2), 0, height - 1)
      const index = (sampleY * width + sampleX) * 4
      let red = sourceData[index]
      let green = sourceData[index + 1]
      let blue = sourceData[index + 2]
      const tone = luminance(red, green, blue) / 255

      if (coverage < 1 && tone > coverage) {
        continue
      }

      let edgeValue = 0
      let samples = 0
      for (let edgeY = Math.max(0, Math.floor(y)); edgeY <= Math.min(height - 1, Math.floor(y + cellHeight)); edgeY += 2) {
        for (let edgeX = Math.max(0, Math.floor(x)); edgeX <= Math.min(width - 1, Math.floor(x + cellWidth)); edgeX += 2) {
          edgeValue += edges[edgeY * width + edgeX]
          samples += 1
        }
      }

      const normalizedEdge = samples > 0 ? edgeValue / samples : 0
      const renderMode = settings.renderMode ?? 'brightness'
      let mapped = renderMode === 'edges' ? 1 - clamp(normalizedEdge / Math.max(0.01, 1 - coverage), 0, 1) : tone
      if (invertMapping) {
        mapped = 1 - mapped
      }
      mapped = clamp(mapped * (1 - edgeWeight) + (1 - normalizedEdge) * edgeWeight * mapped, 0, 1)
      const character = charset[Math.floor(mapped * (charset.length - 1))]
      if (!character || character === ' ') {
        continue
      }

      if (charBrightness !== 0 || charContrast !== 0) {
        red = clamp((red + charOffset - 128) * charMultiplier + 128, 0, 255)
        green = clamp((green + charOffset - 128) * charMultiplier + 128, 0, 255)
        blue = clamp((blue + charOffset - 128) * charMultiplier + 128, 0, 255)
      }

      const animationPhase = animated ? Math.sin(now * animSpeed * Math.PI * 2 + x * 0.03 + y * 0.05) * 0.5 + 0.5 : 1
      const randomPulse = animated ? Math.random() : 0
      const alpha = animated
        ? clamp((animationPhase * (1 - animRandomness) + randomPulse * animRandomness) * animIntensity, 0.15, 1) * charOpacity
        : charOpacity

      glyphs.push({
        x: x + cellWidth / 2,
        y: y + cellHeight / 2,
        character,
        fillStyle: useColor ? `rgb(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)})` : customColor,
        alpha,
      })
    }
  }

  return {
    bgCanvas,
    glyphs,
    font: `700 ${fontSize}px "IBM Plex Mono", monospace`,
    cellWidth,
    cellHeight,
  }
}

const drawAscii = (context, source, width, height, settings, now) => {
  const ascii = renderAsciiLayer(source, width, height, settings, now)
  context.drawImage(ascii.bgCanvas, 0, 0)
  context.font = ascii.font
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  for (const glyph of ascii.glyphs) {
    context.globalAlpha = glyph.alpha
    context.fillStyle = glyph.fillStyle
    context.fillText(glyph.character, glyph.x, glyph.y)
  }
  context.globalAlpha = 1

  if (settings.dotGrid) {
    context.fillStyle = 'rgba(255,255,255,0.12)'
    for (let y = 0; y < height; y += ascii.cellHeight) {
      for (let x = 0; x < width; x += ascii.cellWidth) {
        context.beginPath()
        context.arc(x + ascii.cellWidth / 2, y + ascii.cellHeight / 2, 0.8, 0, Math.PI * 2)
        context.fill()
      }
    }
  }

  applyBrightnessContrast(context, width, height, settings.brightness ?? 0, settings.contrast ?? 0)
}

const applyRegionFilter = (context, region, width, height) => {
  if (region.filter === 'none') {
    return
  }

  const startX = clamp(Math.floor(region.x), 0, width - 1)
  const startY = clamp(Math.floor(region.y), 0, height - 1)
  const regionWidth = clamp(Math.floor(region.width), 1, width - startX)
  const regionHeight = clamp(Math.floor(region.height), 1, height - startY)
  if (regionWidth <= 0 || regionHeight <= 0) {
    return
  }

  const imageData = context.getImageData(startX, startY, regionWidth, regionHeight)
  const { data } = imageData

  switch (region.filter) {
    case 'inv':
      for (let index = 0; index < data.length; index += 4) {
        data[index] = 255 - data[index]
        data[index + 1] = 255 - data[index + 1]
        data[index + 2] = 255 - data[index + 2]
      }
      break
    case 'glitch':
      for (let index = 0; index < data.length; index += 4) {
        if (Math.random() < 0.05) {
          data[index] = clamp(data[index] + 100, 0, 255)
          data[index + 1] = clamp(data[index + 1] - 50, 0, 255)
        }
        if (Math.floor(index / 4 / regionWidth) % 8 < 2) {
          const offset = (Math.floor(Math.random() * 20) - 10) * 4
          const target = clamp(index + offset, 0, data.length - 4)
          data[index] = data[target]
          data[index + 1] = data[target + 1]
          data[index + 2] = data[target + 2]
        }
      }
      break
    case 'thermal':
      for (let index = 0; index < data.length; index += 4) {
        const normalized = luminance(data[index], data[index + 1], data[index + 2]) / 255
        if (normalized < 0.25) {
          data[index] = 0
          data[index + 1] = 0
          data[index + 2] = Math.floor(normalized * 4 * 255)
        } else if (normalized < 0.5) {
          data[index] = Math.floor((normalized - 0.25) * 4 * 255)
          data[index + 1] = 0
          data[index + 2] = 255
        } else if (normalized < 0.75) {
          data[index] = 255
          data[index + 1] = Math.floor((normalized - 0.5) * 4 * 255)
          data[index + 2] = Math.floor((0.75 - normalized) * 4 * 255)
        } else {
          data[index] = 255
          data[index + 1] = 255
          data[index + 2] = Math.floor((normalized - 0.75) * 4 * 255)
        }
      }
      break
    case 'pixel':
      for (let y = 0; y < regionHeight; y += 8) {
        for (let x = 0; x < regionWidth; x += 8) {
          let totalR = 0
          let totalG = 0
          let totalB = 0
          let count = 0
          for (let offsetY = 0; offsetY < 8 && y + offsetY < regionHeight; offsetY += 1) {
            for (let offsetX = 0; offsetX < 8 && x + offsetX < regionWidth; offsetX += 1) {
              const base = ((y + offsetY) * regionWidth + (x + offsetX)) * 4
              totalR += data[base]
              totalG += data[base + 1]
              totalB += data[base + 2]
              count += 1
            }
          }
          const avgR = Math.floor(totalR / count)
          const avgG = Math.floor(totalG / count)
          const avgB = Math.floor(totalB / count)
          for (let offsetY = 0; offsetY < 8 && y + offsetY < regionHeight; offsetY += 1) {
            for (let offsetX = 0; offsetX < 8 && x + offsetX < regionWidth; offsetX += 1) {
              const base = ((y + offsetY) * regionWidth + (x + offsetX)) * 4
              data[base] = avgR
              data[base + 1] = avgG
              data[base + 2] = avgB
            }
          }
        }
      }
      break
    case 'tone':
      for (let index = 0; index < data.length; index += 4) {
        const value = Math.floor(luminance(data[index], data[index + 1], data[index + 2]) / 64) * 64
        data[index] = value
        data[index + 1] = value
        data[index + 2] = value
      }
      break
    case 'blur': {
      const copy = new Uint8ClampedArray(data)
      for (let y = 3; y < regionHeight - 3; y += 1) {
        for (let x = 3; x < regionWidth - 3; x += 1) {
          let totalR = 0
          let totalG = 0
          let totalB = 0
          let samples = 0
          for (let offsetY = -3; offsetY <= 3; offsetY += 1) {
            for (let offsetX = -3; offsetX <= 3; offsetX += 1) {
              const base = ((y + offsetY) * regionWidth + (x + offsetX)) * 4
              totalR += copy[base]
              totalG += copy[base + 1]
              totalB += copy[base + 2]
              samples += 1
            }
          }
          const base = (y * regionWidth + x) * 4
          data[base] = totalR / samples
          data[base + 1] = totalG / samples
          data[base + 2] = totalB / samples
        }
      }
      break
    }
    case 'dither':
      for (let y = 0; y < regionHeight; y += 1) {
        for (let x = 0; x < regionWidth; x += 1) {
          const base = (y * regionWidth + x) * 4
          const threshold = (BAYER_4X4[y % 4][x % 4] / 16) * 255
          const value = luminance(data[base], data[base + 1], data[base + 2]) > threshold ? 255 : 0
          data[base] = value
          data[base + 1] = value
          data[base + 2] = value
        }
      }
      break
    case 'zoom': {
      const copy = new Uint8ClampedArray(data)
      const centerX = regionWidth / 2
      const centerY = regionHeight / 2
      const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY)
      for (let y = 0; y < regionHeight; y += 1) {
        for (let x = 0; x < regionWidth; x += 1) {
          const offsetX = x - centerX
          const offsetY = y - centerY
          const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY)
          const zoom = 1 + (distance / maxDistance) * 0.3
          const sampleX = clamp(Math.round(centerX + offsetX / zoom), 0, regionWidth - 1)
          const sampleY = clamp(Math.round(centerY + offsetY / zoom), 0, regionHeight - 1)
          const sample = (sampleY * regionWidth + sampleX) * 4
          const target = (y * regionWidth + x) * 4
          data[target] = copy[sample]
          data[target + 1] = copy[sample + 1]
          data[target + 2] = copy[sample + 2]
        }
      }
      break
    }
    case 'xray':
      for (let index = 0; index < data.length; index += 4) {
        const inverse = 255 - luminance(data[index], data[index + 1], data[index + 2])
        data[index] = Math.floor(inverse * 0.7)
        data[index + 1] = Math.floor(inverse * 0.85)
        data[index + 2] = inverse
      }
      break
    case 'water': {
      const copy = new Uint8ClampedArray(data)
      for (let y = 0; y < regionHeight; y += 1) {
        for (let x = 0; x < regionWidth; x += 1) {
          const waveX = Math.round(Math.sin(y * 0.15) * 5)
          const waveY = Math.round(Math.cos(x * 0.15) * 5)
          const sampleX = clamp(x + waveX, 0, regionWidth - 1)
          const sampleY = clamp(y + waveY, 0, regionHeight - 1)
          const sample = (sampleY * regionWidth + sampleX) * 4
          const target = (y * regionWidth + x) * 4
          data[target] = copy[sample]
          data[target + 1] = copy[sample + 1]
          data[target + 2] = copy[sample + 2]
        }
      }
      break
    }
    case 'mask': {
      const centerX = regionWidth / 2
      const centerY = regionHeight / 2
      const radius = Math.min(centerX, centerY)
      for (let y = 0; y < regionHeight; y += 1) {
        for (let x = 0; x < regionWidth; x += 1) {
          const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2)
          if (distance > radius * 0.8) {
            const fade = clamp((distance - radius * 0.8) / (radius * 0.2), 0, 1)
            const base = (y * regionWidth + x) * 4
            data[base] *= 1 - fade
            data[base + 1] *= 1 - fade
            data[base + 2] *= 1 - fade
          }
        }
      }
      break
    }
    case 'crt':
      for (let y = 0; y < regionHeight; y += 1) {
        for (let x = 0; x < regionWidth; x += 1) {
          const base = (y * regionWidth + x) * 4
          if (y % 3 === 0) {
            data[base] *= 0.7
            data[base + 1] *= 0.7
            data[base + 2] *= 0.7
          }
          if (x % 3 === 0) {
            data[base + 1] *= 0.8
            data[base + 2] *= 0.8
          } else if (x % 3 === 1) {
            data[base] *= 0.8
            data[base + 2] *= 0.8
          } else {
            data[base] *= 0.8
            data[base + 1] *= 0.8
          }
        }
      }
      break
    case 'edge': {
      const copy = new Uint8ClampedArray(data)
      const sample = (x, y) => {
        const base = (y * regionWidth + x) * 4
        return luminance(copy[base], copy[base + 1], copy[base + 2])
      }
      for (let y = 1; y < regionHeight - 1; y += 1) {
        for (let x = 1; x < regionWidth - 1; x += 1) {
          const gradientX =
            -sample(x - 1, y - 1) -
            2 * sample(x - 1, y) -
            sample(x - 1, y + 1) +
            sample(x + 1, y - 1) +
            2 * sample(x + 1, y) +
            sample(x + 1, y + 1)
          const gradientY =
            -sample(x - 1, y - 1) -
            2 * sample(x, y - 1) -
            sample(x + 1, y - 1) +
            sample(x - 1, y + 1) +
            2 * sample(x, y + 1) +
            sample(x + 1, y + 1)
          const value = clamp(Math.sqrt(gradientX * gradientX + gradientY * gradientY), 0, 255)
          const base = (y * regionWidth + x) * 4
          data[base] = value
          data[base + 1] = value
          data[base + 2] = value
        }
      }
      break
    }
    default:
      break
  }

  context.putImageData(imageData, startX, startY)
}

const drawRegionShape = (context, region, selected) => {
  const stroke = selected ? '#00ff88' : '#ffffff'
  const text = selected ? '#00ff88' : 'rgba(255,255,255,0.85)'

  context.save()
  context.strokeStyle = stroke
  context.fillStyle = stroke
  context.lineWidth = selected ? 2 : 1.5
  context.font = '700 11px "IBM Plex Mono", monospace'
  context.textBaseline = 'top'

  const basicStroke = (dash = []) => {
    context.setLineDash(dash)
    if (region.shape === 'circle') {
      const radius = Math.min(region.width, region.height) / 2
      context.beginPath()
      context.arc(region.x + region.width / 2, region.y + region.height / 2, radius, 0, Math.PI * 2)
      context.stroke()
    } else if (region.shape === 'ellipse') {
      context.beginPath()
      context.ellipse(
        region.x + region.width / 2,
        region.y + region.height / 2,
        region.width / 2,
        region.height / 2,
        0,
        0,
        Math.PI * 2,
      )
      context.stroke()
    } else {
      context.strokeRect(region.x, region.y, region.width, region.height)
    }
    context.setLineDash([])
  }

  switch (region.style) {
    case 'label': {
      basicStroke()
      const width = context.measureText(region.label).width + 10
      context.fillRect(region.x, region.y - 18, width, 16)
      context.fillStyle = '#050505'
      context.fillText(region.label, region.x + 5, region.y - 16)
      break
    }
    case 'frame': {
      const corner = Math.min(region.width, region.height) * 0.25
      context.beginPath()
      context.moveTo(region.x + corner, region.y)
      context.lineTo(region.x, region.y)
      context.lineTo(region.x, region.y + corner)
      context.moveTo(region.x + region.width - corner, region.y)
      context.lineTo(region.x + region.width, region.y)
      context.lineTo(region.x + region.width, region.y + corner)
      context.moveTo(region.x, region.y + region.height - corner)
      context.lineTo(region.x, region.y + region.height)
      context.lineTo(region.x + corner, region.y + region.height)
      context.moveTo(region.x + region.width, region.y + region.height - corner)
      context.lineTo(region.x + region.width, region.y + region.height)
      context.lineTo(region.x + region.width - corner, region.y + region.height)
      context.stroke()
      context.fillText(region.label, region.x + 4, region.y + 4)
      break
    }
    case 'l-frame': {
      const corner = Math.min(region.width, region.height) * 0.35
      context.beginPath()
      context.moveTo(region.x, region.y + corner)
      context.lineTo(region.x, region.y)
      context.lineTo(region.x + corner, region.y)
      context.moveTo(region.x + region.width, region.y + region.height - corner)
      context.lineTo(region.x + region.width, region.y + region.height)
      context.lineTo(region.x + region.width - corner, region.y + region.height)
      context.stroke()
      context.fillText(region.label, region.x + 4, region.y + 4)
      break
    }
    case 'x-frame':
      basicStroke()
      context.globalAlpha = 0.35
      context.beginPath()
      context.moveTo(region.x, region.y)
      context.lineTo(region.x + region.width, region.y + region.height)
      context.moveTo(region.x + region.width, region.y)
      context.lineTo(region.x, region.y + region.height)
      context.stroke()
      context.globalAlpha = 1
      context.fillText(region.label, region.x + 4, region.y + 4)
      break
    case 'grid': {
      basicStroke()
      context.globalAlpha = 0.2
      context.strokeStyle = text
      const step = Math.max(15, Math.min(region.width, region.height) / 5)
      for (let x = region.x + step; x < region.x + region.width; x += step) {
        context.beginPath()
        context.moveTo(x, region.y)
        context.lineTo(x, region.y + region.height)
        context.stroke()
      }
      for (let y = region.y + step; y < region.y + region.height; y += step) {
        context.beginPath()
        context.moveTo(region.x, y)
        context.lineTo(region.x + region.width, y)
        context.stroke()
      }
      context.globalAlpha = 1
      context.strokeStyle = stroke
      context.fillStyle = stroke
      context.fillText(region.label, region.x + 4, region.y + 4)
      break
    }
    case 'particle': {
      const particles = Math.max(20, Math.floor((region.width * region.height) / 400))
      for (let index = 0; index < particles; index += 1) {
        const x = region.x + Math.random() * region.width
        const y = region.y + Math.random() * region.height
        context.globalAlpha = 0.7
        context.fillRect(x, y, 2, 2)
      }
      context.globalAlpha = 1
      context.fillText(region.label, region.x + 4, region.y + 4)
      break
    }
    case 'dash':
      basicStroke([6, 4])
      context.fillText(region.label, region.x + 4, region.y + 4)
      break
    case 'scope': {
      const centerX = region.x + region.width / 2
      const centerY = region.y + region.height / 2
      const radius = Math.min(region.width, region.height) / 2
      context.beginPath()
      context.arc(centerX, centerY, radius, 0, Math.PI * 2)
      context.stroke()
      context.beginPath()
      context.moveTo(centerX - radius, centerY)
      context.lineTo(centerX + radius, centerY)
      context.moveTo(centerX, centerY - radius)
      context.lineTo(centerX, centerY + radius)
      context.stroke()
      context.globalAlpha = 0.3
      context.beginPath()
      context.arc(centerX, centerY, radius * 0.66, 0, Math.PI * 2)
      context.stroke()
      context.beginPath()
      context.arc(centerX, centerY, radius * 0.33, 0, Math.PI * 2)
      context.stroke()
      context.globalAlpha = 1
      context.fillText(region.label, region.x + 4, region.y - 14)
      break
    }
    case 'win2k':
      context.strokeRect(region.x, region.y, region.width, region.height)
      context.fillStyle = 'rgba(20,68,190,0.8)'
      context.fillRect(region.x, region.y, region.width, 20)
      context.fillStyle = '#f7f7f7'
      context.font = '700 11px sans-serif'
      context.fillText(region.label, region.x + 4, region.y + 4)
      context.strokeStyle = text
      context.strokeRect(region.x + region.width - 18, region.y + 3, 14, 14)
      context.fillStyle = text
      context.fillText('x', region.x + region.width - 15, region.y + 4)
      break
    case 'label2': {
      basicStroke()
      const width = context.measureText(region.label).width + 10
      const boxX = region.x + region.width / 2 - width / 2
      const boxY = region.y + region.height + 4
      context.fillStyle = 'rgba(0,0,0,0.72)'
      context.fillRect(boxX, boxY, width, 18)
      context.strokeRect(boxX, boxY, width, 18)
      context.fillStyle = stroke
      context.fillText(region.label, boxX + 5, boxY + 3)
      break
    }
    case 'basic':
    default:
      basicStroke(region.style === 'dash' ? [6, 4] : [])
      break
  }

  if (region.style === 'basic') {
    context.fillStyle = text
    context.fillText(region.label, region.x + 4, region.y + 4)
  }

  context.restore()
}

const drawConnections = (context, regions, style, rate) => {
  if (regions.length < 2) {
    return
  }

  context.save()
  context.strokeStyle = 'rgba(255,255,255,0.35)'
  context.lineWidth = 1
  if (style === 'dashed') {
    context.setLineDash([8, 5])
  } else if (style === 'dotted') {
    context.setLineDash([2, 4])
  } else {
    context.setLineDash([])
  }

  const limit = Math.sqrt(context.canvas.width ** 2 + context.canvas.height ** 2) * (rate / 100)
  for (let left = 0; left < regions.length; left += 1) {
    for (let right = left + 1; right < regions.length; right += 1) {
      const regionA = regions[left]
      const regionB = regions[right]
      const centerAX = regionA.x + regionA.width / 2
      const centerAY = regionA.y + regionA.height / 2
      const centerBX = regionB.x + regionB.width / 2
      const centerBY = regionB.y + regionB.height / 2
      const distance = Math.hypot(centerAX - centerBX, centerAY - centerBY)
      if (distance > limit) {
        continue
      }
      context.beginPath()
      context.moveTo(centerAX, centerAY)
      context.lineTo(centerBX, centerBY)
      context.stroke()
    }
  }

  context.restore()
}

const applyBlurSuite = (context, source, width, height, settings) => {
  const amount = Math.max(0.5, settings.intensity / 3.5)
  const centerX = width * (0.5 + (settings.motionX ?? 0) * 0.5)
  const centerY = height * (0.5 + (settings.motionY ?? 0) * 0.5)
  const { canvas: sourceCanvas, context: sourceContext } = copyCanvas(width, height, source)
  const sourceData = sourceContext.getImageData(0, 0, width, height)
  const target = context.createImageData(width, height)

  if (settings.mode === 'linear') {
    context.filter = `blur(${amount}px)`
    context.drawImage(source, 0, 0, width, height)
    context.filter = 'none'
  } else if (settings.mode === 'wave') {
    const { data } = sourceData
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sampleX = clamp(Math.round(x + Math.sin(y * 0.03) * amount * 2), 0, width - 1)
        const sampleY = clamp(Math.round(y + Math.cos(x * 0.02) * amount), 0, height - 1)
        const sample = (sampleY * width + sampleX) * 4
        const targetIndex = (y * width + x) * 4
        target.data[targetIndex] = data[sample]
        target.data[targetIndex + 1] = data[sample + 1]
        target.data[targetIndex + 2] = data[sample + 2]
        target.data[targetIndex + 3] = 255
      }
    }
    context.putImageData(target, 0, 0)
  } else if (settings.mode === 'tb' || settings.mode === 'lr') {
    context.drawImage(source, 0, 0, width, height)
    const overlay = document.createElement('canvas')
    overlay.width = width
    overlay.height = height
    const overlayContext = overlay.getContext('2d')
    overlayContext.filter = `blur(${amount * 1.4}px)`
    overlayContext.drawImage(source, 0, 0, width, height)
    overlayContext.filter = 'none'

    const position = (settings.maskPosition ?? 50) / 100
    const softness = clamp((settings.maskSoftness ?? 40) / 100, 0.01, 1)
    const start = clamp(position - softness / 2, 0, 1)
    const end = clamp(position + softness / 2, 0, 1)
    const gradient =
      settings.mode === 'tb'
        ? context.createLinearGradient(0, 0, 0, height)
        : context.createLinearGradient(0, 0, width, 0)

    gradient.addColorStop(0, 'rgba(0,0,0,0)')
    gradient.addColorStop(start, 'rgba(0,0,0,0)')
    gradient.addColorStop(position, 'rgba(0,0,0,1)')
    gradient.addColorStop(end, 'rgba(0,0,0,0)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')

    overlayContext.globalCompositeOperation = 'destination-in'
    overlayContext.fillStyle = gradient
    overlayContext.fillRect(0, 0, width, height)
    context.drawImage(overlay, 0, 0)
  } else if (settings.mode === 'radial' || settings.mode === 'zoom') {
    const { data } = sourceData
    const samples = clamp(Math.floor(settings.intensity / 4), 8, 24)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dx = x - centerX
        const dy = y - centerY
        const targetIndex = (y * width + x) * 4
        let totalR = 0
        let totalG = 0
        let totalB = 0
        for (let step = 0; step < samples; step += 1) {
          const ratio = step / Math.max(1, samples - 1)
          let sampleX = x
          let sampleY = y
          if (settings.mode === 'radial') {
            const angle = Math.atan2(dy, dx) + (ratio - 0.5) * (settings.intensity / 100) * 0.7
            const distance = Math.sqrt(dx * dx + dy * dy)
            sampleX = clamp(Math.round(centerX + distance * Math.cos(angle)), 0, width - 1)
            sampleY = clamp(Math.round(centerY + distance * Math.sin(angle)), 0, height - 1)
          } else {
            const zoom = ratio * (settings.intensity / 100) * 0.55
            sampleX = clamp(Math.round(x - dx * zoom), 0, width - 1)
            sampleY = clamp(Math.round(y - dy * zoom), 0, height - 1)
          }
          const sample = (sampleY * width + sampleX) * 4
          totalR += data[sample]
          totalG += data[sample + 1]
          totalB += data[sample + 2]
        }
        target.data[targetIndex] = totalR / samples
        target.data[targetIndex + 1] = totalG / samples
        target.data[targetIndex + 2] = totalB / samples
        target.data[targetIndex + 3] = 255
      }
    }
    context.putImageData(target, 0, 0)
  } else if (settings.mode === 'tilt-shift') {
    context.drawImage(source, 0, 0, width, height)
    const overlay = document.createElement('canvas')
    overlay.width = width
    overlay.height = height
    const overlayContext = overlay.getContext('2d')
    overlayContext.filter = `blur(${amount * 1.5}px) saturate(${1 + (settings.saturation ?? 0) / 100})`
    overlayContext.drawImage(source, 0, 0, width, height)
    overlayContext.filter = 'none'
    const focusCenter = (settings.focusY ?? 50) / 100
    const focusWidth = (settings.focusWidth ?? 20) / 100
    const softness = (settings.softness ?? 30) / 100
    const start = clamp(focusCenter - focusWidth / 2 - softness / 2, 0, 1)
    const midStart = clamp(focusCenter - focusWidth / 2, 0, 1)
    const midEnd = clamp(focusCenter + focusWidth / 2, 0, 1)
    const end = clamp(focusCenter + focusWidth / 2 + softness / 2, 0, 1)
    const gradient = overlayContext.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, 'rgba(0,0,0,1)')
    gradient.addColorStop(start, 'rgba(0,0,0,1)')
    gradient.addColorStop(midStart, 'rgba(0,0,0,0)')
    gradient.addColorStop(midEnd, 'rgba(0,0,0,0)')
    gradient.addColorStop(end, 'rgba(0,0,0,1)')
    gradient.addColorStop(1, 'rgba(0,0,0,1)')
    overlayContext.globalCompositeOperation = 'destination-in'
    overlayContext.fillStyle = gradient
    overlayContext.fillRect(0, 0, width, height)
    context.drawImage(overlay, 0, 0)
  } else {
    context.drawImage(source, 0, 0, width, height)
  }

  if (settings.gradientMask && settings.mode !== 'tb' && settings.mode !== 'lr' && settings.mode !== 'tilt-shift') {
    const overlay = document.createElement('canvas')
    overlay.width = width
    overlay.height = height
    const overlayContext = overlay.getContext('2d')
    overlayContext.drawImage(context.canvas, 0, 0)
    const angle = ((settings.maskDirection ?? 0) * Math.PI) / 180
    const radius = Math.sqrt(width * width + height * height) / 2
    const center = { x: width / 2, y: height / 2 }
    const startX = center.x - Math.cos(angle) * radius
    const startY = center.y - Math.sin(angle) * radius
    const endX = center.x + Math.cos(angle) * radius
    const endY = center.y + Math.sin(angle) * radius
    const position = (settings.maskPosition ?? 50) / 100
    const softness = clamp((settings.maskSoftness ?? 40) / 100, 0.04, 1) * 0.6
    const gradient = overlayContext.createLinearGradient(startX, startY, endX, endY)
    const before = clamp(position - softness, 0, 1)
    const after = clamp(position + softness, 0, 1)
    gradient.addColorStop(before, 'rgba(0,0,0,1)')
    gradient.addColorStop(position, 'rgba(0,0,0,0.55)')
    gradient.addColorStop(after, 'rgba(0,0,0,0)')
    overlayContext.globalCompositeOperation = 'destination-in'
    overlayContext.fillStyle = gradient
    overlayContext.fillRect(0, 0, width, height)
    context.clearRect(0, 0, width, height)
    context.drawImage(sourceCanvas, 0, 0)
    context.drawImage(overlay, 0, 0)
  }

  if (settings.rgbShift > 0) {
    context.globalAlpha = 0.4
    context.globalCompositeOperation = 'screen'
    context.fillStyle = 'rgba(255,32,32,0.25)'
    context.fillRect(0, 0, width, height)
    context.drawImage(context.canvas, settings.rgbShift * 0.3, 0)
    context.fillStyle = 'rgba(32,255,255,0.18)'
    context.fillRect(0, 0, width, height)
    context.drawImage(context.canvas, -settings.rgbShift * 0.3, 0)
    context.globalCompositeOperation = 'source-over'
    context.globalAlpha = 1
  }

  if (settings.bloom) {
    context.globalAlpha = 0.18
    context.filter = `blur(${amount * 2}px)`
    context.drawImage(context.canvas, 0, 0)
    context.filter = 'none'
    context.globalAlpha = 1
  }

  if (settings.grain > 0) {
    const grain = context.getImageData(0, 0, width, height)
    const amount = settings.grain * 2.55
    for (let index = 0; index < grain.data.length; index += 4) {
      const noise = (Math.random() - 0.5) * amount
      grain.data[index] = clamp(grain.data[index] + noise, 0, 255)
      grain.data[index + 1] = clamp(grain.data[index + 1] + noise, 0, 255)
      grain.data[index + 2] = clamp(grain.data[index + 2] + noise, 0, 255)
    }
    context.putImageData(grain, 0, 0)
  }
}

export const renderEffect = ({
  context,
  image,
  effectId,
  settings,
  width,
  height,
  regions,
  selectedRegionId,
  connectionStyle,
  connectionRate,
  now = 0,
}) => {
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#040404'
  context.fillRect(0, 0, width, height)

  switch (effectId) {
    case 'blur-suite':
      applyBlurSuite(context, image, width, height, settings)
      break
    case 'color-htone': {
      const { context: sourceContext } = copyCanvas(width, height, image)
      const sourceData = sourceContext.getImageData(0, 0, width, height).data
      const dotSize = Math.max(2, settings.dotSize ?? 8)
      const mix = (settings.mix ?? 100) / 100
      context.fillStyle = settings.background ?? '#ffffff'
      context.fillRect(0, 0, width, height)
      const channels =
        settings.colorMode === 'rgb'
          ? [
              { color: '#ff2442', offsetX: 0, offsetY: 0, read: (r) => r / 255 },
              { color: '#0dff8f', offsetX: dotSize * 0.33, offsetY: dotSize * 0.33, read: (_, g) => g / 255 },
              { color: '#40a4ff', offsetX: dotSize * 0.66, offsetY: dotSize * 0.66, read: (_, __, b) => b / 255 },
            ]
          : [
              { color: '#00aaff', offsetX: 0, offsetY: 0, read: (r) => 1 - r / 255 },
              { color: '#ff00aa', offsetX: dotSize * 0.5, offsetY: 0, read: (_, g) => 1 - g / 255 },
              { color: '#ffd300', offsetX: 0, offsetY: dotSize * 0.5, read: (_, __, b) => 1 - b / 255 },
              { color: '#111111', offsetX: dotSize * 0.25, offsetY: dotSize * 0.25, read: (r, g, b) => 1 - ((r + g + b) / 765) * 0.7 },
            ]

      context.globalCompositeOperation = 'multiply'
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      for (const channel of channels) {
        context.fillStyle = channel.color
        for (let y = -dotSize; y < height + dotSize; y += dotSize) {
          for (let x = -dotSize; x < width + dotSize; x += dotSize) {
            const sampleX = clamp(Math.floor(x + channel.offsetX), 0, width - 1)
            const sampleY = clamp(Math.floor(y + channel.offsetY), 0, height - 1)
            const base = (sampleY * width + sampleX) * 4
            const radius = channel.read(sourceData[base], sourceData[base + 1], sourceData[base + 2]) * mix * dotSize * 0.55
            if (radius <= 0.4) {
              continue
            }
            context.beginPath()
            context.arc(x + channel.offsetX + dotSize * 0.5, y + channel.offsetY + dotSize * 0.5, radius, 0, Math.PI * 2)
            context.fill()
          }
        }
      }
      context.globalCompositeOperation = 'source-over'
      applyBrightnessContrast(context, width, height, settings.brightness ?? 0, settings.contrast ?? 0)
      break
    }
    case 'glassify': {
      const copy = copyCanvas(width, height, image).canvas
      const layers = settings.layers ?? 5
      const centerX = width / 2
      const centerY = height / 2
      const radius = (settings.radius ?? 100) / 100
      const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY) * radius
      for (let layer = layers - 1; layer >= 0; layer -= 1) {
        const outerRadius = maxRadius * ((layer + 1) / layers)
        const innerRadius = maxRadius * (layer / layers)
        context.save()
        context.beginPath()
        context.arc(centerX, centerY, outerRadius, 0, Math.PI * 2)
        if (layer > 0) {
          context.arc(centerX, centerY, innerRadius, 0, Math.PI * 2, true)
        }
        context.clip()
        context.translate(centerX, centerY)
        context.rotate(layer * (settings.rotation ?? 0.15))
        context.translate(-centerX, -centerY)
        context.drawImage(copy, 0, 0)
        context.restore()
      }
      const shadowStrength = (settings.shadowStrength ?? 40) / 100
      const highlightStrength = (settings.highlightStrength ?? 30) / 100
      for (let layer = 1; layer < layers; layer += 1) {
        const radius = maxRadius * (layer / layers)
        if (shadowStrength > 0) {
          context.beginPath()
          context.arc(centerX, centerY, radius, 0, Math.PI * 2)
          context.strokeStyle = `rgba(0,0,0,${shadowStrength})`
          context.lineWidth = settings.shadowWidth ?? 2
          context.stroke()
        }
        if (highlightStrength > 0) {
          context.beginPath()
          context.arc(centerX, centerY, radius + (settings.shadowWidth ?? 2) * 0.5, 0, Math.PI * 2)
          context.strokeStyle = `rgba(255,255,255,${highlightStrength})`
          context.lineWidth = settings.highlightWidth ?? 1
          context.stroke()
        }
      }
      break
    }
    case 'ascii-kit':
      drawAscii(context, image, width, height, settings, now)
      break
    case 'image-track': {
      context.drawImage(image, 0, 0, width, height)
      const strength = settings.strength ?? 50
      context.globalAlpha = 0.1
      for (let index = 1; index < 10; index += 1) {
        context.drawImage(image, index * (strength / 10), index * (strength / 20), width, height)
        context.drawImage(image, -index * (strength / 15), index * (strength / 10), width, height)
      }
      context.globalAlpha = 1
      break
    }
    case 'half-tone': {
      const { context: sourceContext } = copyCanvas(width, height, image)
      const sourceData = sourceContext.getImageData(0, 0, width, height).data
      const dotSize = settings.dotSize ?? 6
      context.fillStyle = '#0a0a0a'
      context.fillRect(0, 0, width, height)
      context.fillStyle = settings.color ?? '#f7f7f2'
      for (let y = 0; y < height; y += dotSize) {
        for (let x = 0; x < width; x += dotSize) {
          const base = (y * width + x) * 4
          const radius = (luminance(sourceData[base], sourceData[base + 1], sourceData[base + 2]) / 255) * dotSize * 0.5
          if (radius <= 0.5) {
            continue
          }
          context.beginPath()
          context.arc(x + dotSize / 2, y + dotSize / 2, radius, 0, Math.PI * 2)
          context.fill()
        }
      }
      break
    }
    case 'retroman': {
      const { context: sourceContext } = copyCanvas(width, height, image)
      const sourceData = sourceContext.getImageData(0, 0, width, height).data
      const scale = settings.scale ?? 2
      const color = settings.color ?? '#f7f7f2'
      for (let y = 0; y < height; y += scale) {
        for (let x = 0; x < width; x += scale) {
          const base = (y * width + x) * 4
          const value = luminance(sourceData[base], sourceData[base + 1], sourceData[base + 2])
          const threshold = (BAYER_4X4[y % 4][x % 4] / 16) * 255
          context.fillStyle = value > threshold ? color : '#0a0a0a'
          context.fillRect(x, y, scale, scale)
        }
      }
      break
    }
    case 'glitch-kit': {
      context.drawImage(image, 0, 0, width, height)
      if ((settings.colorShift ?? 0) > 0) {
        context.globalCompositeOperation = 'screen'
        context.globalAlpha = 0.5
        context.fillStyle = 'red'
        context.fillRect(0, 0, width, height)
        context.globalCompositeOperation = 'multiply'
        context.drawImage(image, settings.colorShift, 0, width, height)
        context.globalCompositeOperation = 'screen'
        context.fillStyle = 'cyan'
        context.fillRect(0, 0, width, height)
        context.globalCompositeOperation = 'multiply'
        context.drawImage(image, -settings.colorShift, 0, width, height)
        context.globalCompositeOperation = 'source-over'
        context.globalAlpha = 1
      }
      const slices = Math.floor((settings.intensity ?? 50) / 2)
      for (let index = 0; index < slices; index += 1) {
        const x = Math.random() * width
        const y = Math.random() * height
        const sliceWidth = Math.random() * (width / 4)
        const sliceHeight = Math.random() * (height / 10)
        context.drawImage(
          context.canvas,
          x,
          y,
          sliceWidth,
          sliceHeight,
          x + (Math.random() - 0.5) * (settings.intensity ?? 50) * 2,
          y,
          sliceWidth,
          sliceHeight,
        )
      }
      if (settings.scanlines) {
        context.fillStyle = 'rgba(0,0,0,0.2)'
        for (let y = 0; y < height; y += 4) {
          context.fillRect(0, y, width, 2)
        }
      }
      break
    }
    case 'vintage-kit': {
      context.filter = `sepia(${settings.sepia ?? 80}%) contrast(115%)`
      context.drawImage(image, 0, 0, width, height)
      context.filter = 'none'
      const vignette = context.createRadialGradient(width / 2, height / 2, width / 4, width / 2, height / 2, width)
      vignette.addColorStop(0, 'rgba(0,0,0,0)')
      vignette.addColorStop(1, `rgba(0,0,0,${(settings.vignette ?? 50) / 100})`)
      context.fillStyle = vignette
      context.fillRect(0, 0, width, height)
      if ((settings.grain ?? 0) > 0) {
        const grain = context.getImageData(0, 0, width, height)
        const amount = (settings.grain ?? 0) * 2.55
        for (let index = 0; index < grain.data.length; index += 4) {
          if (Math.random() < 0.5) {
            const noise = Math.random() * amount
            grain.data[index] = clamp(grain.data[index] + noise, 0, 255)
            grain.data[index + 1] = clamp(grain.data[index + 1] + noise, 0, 255)
            grain.data[index + 2] = clamp(grain.data[index + 2] + noise, 0, 255)
          }
        }
        context.putImageData(grain, 0, 0)
      }
      break
    }
    case 'img-track': {
      context.drawImage(image, 0, 0, width, height)
      for (const region of regions) {
        applyRegionFilter(context, region, width, height)
      }
      drawConnections(context, regions, connectionStyle, connectionRate)
      for (const region of regions) {
        drawRegionShape(context, region, region.id === selectedRegionId)
      }
      break
    }
    default:
      context.drawImage(image, 0, 0, width, height)
      break
  }
}

export const drawDraftRegion = (context, draftRegion) => {
  if (!draftRegion) {
    return
  }

  drawRegionShape(context, { ...draftRegion, label: 'Draft', style: draftRegion.style ?? 'basic' }, true)
}

export const makeRegionLabel = (count) => `Region ${count + 1}`

export const getRegionStyleLabel = (id) => REGION_STYLES.find((style) => style.id === id)?.label ?? id
