import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cubeObjPath = path.join(__dirname, 'fixtures', 'cube.obj')

const readCanvasInfo = async (page) =>
  page.locator('.preview-canvas').evaluate((canvas) => {
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const sampleSize = 24
    const startX = Math.max(0, Math.floor(canvas.width / 2) - sampleSize / 2)
    const startY = Math.max(0, Math.floor(canvas.height / 2) - sampleSize / 2)
    const data = context.getImageData(startX, startY, sampleSize, sampleSize).data

    let alphaSum = 0
    let hash = 0
    for (let index = 0; index < data.length; index += 1) {
      alphaSum += index % 4 === 3 ? data[index] : 0
      hash = (hash * 31 + data[index]) % 2147483647
    }

    return {
      alphaSum,
      hash,
      height: canvas.height,
      width: canvas.width,
    }
  })

test.describe('3D preview', () => {
  test('renders an uploaded OBJ into the visible preview canvas', async ({ page }) => {
    const pageErrors = []
    const consoleErrors = []

    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })

    await page.goto('/')
    await page.locator('input[accept=".obj,.gltf,.glb,model/gltf-binary,model/gltf+json"]').setInputFiles(cubeObjPath)

    await expect(page.getByText('3D source: cube.obj')).toBeVisible()
    await expect(page.getByText('Drag to orbit the model.')).toBeVisible()

    await expect
      .poll(async () => (await readCanvasInfo(page)).width, { message: 'preview canvas should resize to the viewport' })
      .toBeGreaterThan(500)

    await expect
      .poll(async () => (await readCanvasInfo(page)).alphaSum, { message: 'preview canvas should contain rendered pixels' })
      .toBeGreaterThan(0)

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('updates the 3D preview when changing effects and dragging the model', async ({ page }) => {
    await page.goto('/')
    await page.locator('input[accept=".obj,.gltf,.glb,model/gltf-binary,model/gltf+json"]').setInputFiles(cubeObjPath)

    await expect(page.getByText('3D source: cube.obj')).toBeVisible()
    await expect.poll(async () => (await readCanvasInfo(page)).alphaSum).toBeGreaterThan(0)

    const initialInfo = await readCanvasInfo(page)

    await page.getByRole('button', { name: 'ASCII' }).click()
    await expect
      .poll(async () => (await readCanvasInfo(page)).hash, { message: 'effect changes should redraw the 3D preview' })
      .not.toBe(initialInfo.hash)

    const afterEffectInfo = await readCanvasInfo(page)
    const canvas = page.locator('.preview-canvas')
    const box = await canvas.boundingBox()
    if (!box) {
      throw new Error('Preview canvas not visible.')
    }

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 - 60, {
      steps: 8,
    })
    await page.mouse.up()

    await expect
      .poll(async () => (await readCanvasInfo(page)).hash, { message: 'dragging should orbit and redraw the model' })
      .not.toBe(afterEffectInfo.hash)
  })
})

test.describe('Webcam source', () => {
  test('starts the webcam source and renders a live preview', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Use webcam' }).click()

    await expect(page.getByText(/Webcam live · \d+ × \d+/)).toBeVisible()

    await expect
      .poll(async () => (await readCanvasInfo(page)).width, { message: 'webcam preview should size the visible canvas' })
      .toBeGreaterThan(500)

    await expect
      .poll(async () => (await readCanvasInfo(page)).alphaSum, { message: 'webcam preview should produce visible pixels' })
      .toBeGreaterThan(0)
  })
})
