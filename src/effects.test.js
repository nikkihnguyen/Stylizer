import { describe, expect, it } from 'vitest'
import { renderEffect } from './effects'

const createPixelContext = (width, height, pixels) => {
  const buffer = new Uint8ClampedArray(pixels)

  const readRegion = (x, y, regionWidth, regionHeight) => {
    const data = new Uint8ClampedArray(regionWidth * regionHeight * 4)
    for (let row = 0; row < regionHeight; row += 1) {
      for (let column = 0; column < regionWidth; column += 1) {
        const sourceIndex = ((y + row) * width + (x + column)) * 4
        const targetIndex = (row * regionWidth + column) * 4
        data[targetIndex] = buffer[sourceIndex]
        data[targetIndex + 1] = buffer[sourceIndex + 1]
        data[targetIndex + 2] = buffer[sourceIndex + 2]
        data[targetIndex + 3] = buffer[sourceIndex + 3]
      }
    }

    return { data }
  }

  const writeRegion = (imageData, x, y) => {
    const regionWidth = imageData.width
    const regionHeight = imageData.height
    for (let row = 0; row < regionHeight; row += 1) {
      for (let column = 0; column < regionWidth; column += 1) {
        const sourceIndex = (row * regionWidth + column) * 4
        const targetIndex = ((y + row) * width + (x + column)) * 4
        buffer[targetIndex] = imageData.data[sourceIndex]
        buffer[targetIndex + 1] = imageData.data[sourceIndex + 1]
        buffer[targetIndex + 2] = imageData.data[sourceIndex + 2]
        buffer[targetIndex + 3] = imageData.data[sourceIndex + 3]
      }
    }
  }

  return {
    arc() {},
    beginPath() {},
    clearRect() {},
    drawImage() {},
    ellipse() {},
    fill() {},
    fillRect() {},
    fillText() {},
    font: '',
    getImageData(x, y, regionWidth, regionHeight) {
      return {
        data: readRegion(x, y, regionWidth, regionHeight).data,
        height: regionHeight,
        width: regionWidth,
      }
    },
    lineTo() {},
    measureText(text) {
      return { width: text.length * 6 }
    },
    moveTo() {},
    putImageData(imageData, x, y) {
      writeRegion(imageData, x, y)
    },
    restore() {},
    save() {},
    setLineDash() {},
    stroke() {},
    strokeRect() {},
    textBaseline: 'top',
    get pixels() {
      return Array.from(buffer)
    },
  }
}

const baseRegion = {
  filter: 'none',
  filterIntensity: 100,
  height: 1,
  invertRegion: true,
  shape: 'rectangle',
  style: 'basic',
  width: 1,
  x: 0,
  y: 0,
}

describe('renderEffect img-track inversion', () => {
  it('inverts pixels inside the region when invert scope is inside', () => {
    const context = createPixelContext(2, 1, [
      10, 20, 30, 255,
      100, 150, 200, 255,
    ])

    renderEffect({
      connectionRate: 50,
      connectionStyle: 'solid',
      context,
      effectId: 'img-track',
      height: 1,
      image: {},
      now: 0,
      regions: [
        {
          ...baseRegion,
          id: 'region-1',
          invertScope: 'inside',
          label: 'Region 1',
        },
      ],
      selectedRegionId: null,
      settings: {},
      width: 2,
    })

    expect(context.pixels).toEqual([
      245, 235, 225, 255,
      100, 150, 200, 255,
    ])
  })

  it('inverts pixels outside the region when invert scope is outside', () => {
    const context = createPixelContext(2, 1, [
      10, 20, 30, 255,
      100, 150, 200, 255,
    ])

    renderEffect({
      connectionRate: 50,
      connectionStyle: 'solid',
      context,
      effectId: 'img-track',
      height: 1,
      image: {},
      now: 0,
      regions: [
        {
          ...baseRegion,
          id: 'region-1',
          invertScope: 'outside',
          label: 'Region 1',
        },
      ],
      selectedRegionId: null,
      settings: {},
      width: 2,
    })

    expect(context.pixels).toEqual([
      10, 20, 30, 255,
      155, 105, 55, 255,
    ])
  })
})
