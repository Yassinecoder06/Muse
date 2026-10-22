import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isImageGenerationPrompt,
  isImageEditingPrompt,
  parseImageData,
  GEMINI_IMAGE_MODELS,
  DEFAULT_IMAGE_MODEL
} from './image-generation.service.js'

test('detects image generation intent from various natural prompts', () => {
  assert.equal(isImageGenerationPrompt('generate an image of a cybernetic cat in Tokyo'), true)
  assert.equal(isImageGenerationPrompt('draw a cute watercolor robot playing violin'), true)
  assert.equal(isImageGenerationPrompt('Can you paint a sunset over futuristic mountains?'), true)
  assert.equal(isImageGenerationPrompt('create an illustration of a music playlist cover'), true)
  assert.equal(isImageGenerationPrompt('image of a coffee shop in Paris in autumn'), true)
  assert.equal(isImageGenerationPrompt('make a sketch of a bird'), true)

  // Non-generation prompts
  assert.equal(isImageGenerationPrompt('What are my tasks for today?'), false)
  assert.equal(isImageGenerationPrompt('Summarize the note about chemistry'), false)
  assert.equal(isImageGenerationPrompt('Play some lo-fi jazz music'), false)
})

test('detects image editing intent when an image is attached', () => {
  // With image attached
  assert.equal(isImageEditingPrompt('make the background dark cyberpunk', true), true)
  assert.equal(isImageEditingPrompt('edit this image to remove the watermark', true), true)
  assert.equal(isImageEditingPrompt('turn this into an oil painting', true), true)
  assert.equal(isImageEditingPrompt('change the hair color to blue', true), true)

  // Without image attached, editing intent should not trigger
  assert.equal(isImageEditingPrompt('make the background dark cyberpunk', false), false)
  assert.equal(isImageEditingPrompt('edit this image', false), false)
})

test('parses data URLs and raw base64 data correctly', () => {
  const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
  const parsed1 = parseImageData(dataUrl)
  assert.equal(parsed1.mimeType, 'image/jpeg')
  assert.equal(parsed1.data, '/9j/4AAQSkZJRg==')

  const rawBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const parsed2 = parseImageData(rawBase64, 'image/png')
  assert.equal(parsed2.mimeType, 'image/png')
  assert.equal(parsed2.data, rawBase64)
})

test('Gemini image model catalog includes Nano Banana 2.1 as default', () => {
  assert.equal(DEFAULT_IMAGE_MODEL, 'gemini-nano-banana-2.1')
  assert.ok(GEMINI_IMAGE_MODELS.includes('gemini-nano-banana-2.1'))
  assert.ok(GEMINI_IMAGE_MODELS.includes('gemini-3.1-flash-image'))
})
