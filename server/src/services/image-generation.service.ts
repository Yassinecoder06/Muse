import { GoogleGenAI } from '@google/genai'
import { supabase } from '../supabase/client.js'
import { settings } from './settings.repository.js'

export const GEMINI_IMAGE_MODELS = [
  'gemini-nano-banana-2.1',       // Google's newest and default Nano Banana 2.1 model for high-efficiency image generation and conversational editing
  'gemini-3.1-flash-image',       // Nano Banana 2
  'gemini-3.1-flash-lite-image',  // Nano Banana 2 Lite
  'gemini-3-pro-image',           // Nano Banana Pro
  'gemini-2.5-flash-image'        // Nano Banana legacy
] as const

export const DEFAULT_IMAGE_MODEL = 'gemini-nano-banana-2.1'

export interface ImageAttachment {
  mimeType: string
  data: string // base64 string
  url?: string
}

export interface GeneratedImageResult {
  imageUrl: string
  imageId: string
  mimeType: string
  base64Data: string
  text?: string
  modelUsed: string
  prompt: string
  isEdit: boolean
}

/**
 * Detects whether a prompt expresses an intent to generate an image from text.
 */
export function isImageGenerationPrompt(prompt: string): boolean {
  if (!prompt || typeof prompt !== 'string') return false
  const p = prompt.trim().toLowerCase()

  // Common image generation triggers
  const genPatterns = [
    /\b(generate|create|make|draw|paint|sketch|render|produce|design)\s+(an?\s+)?(image|picture|photo|photograph|illustration|drawing|artwork|graphic|portrait|wallpaper|diagram|logo|banner|sketch)\b/i,
    /\b(draw|paint|illustrate|sketch)\s+(me\s+)?(a|an|the|some)\b/i,
    /^(image of|picture of|photo of|drawing of|illustration of|painting of|sketch of)\s+/i,
    /\bcan you (draw|paint|illustrate|generate an image|create an image|make an image)\b/i,
    /\b(text to image|t2i)\b/i
  ]

  return genPatterns.some(pattern => pattern.test(p))
}

/**
 * Detects whether a prompt expresses an intent to edit/modify an existing image.
 */
export function isImageEditingPrompt(prompt: string, hasInputImage: boolean): boolean {
  if (!hasInputImage || !prompt || typeof prompt !== 'string') return false
  const p = prompt.trim().toLowerCase()

  const editPatterns = [
    /\b(edit|change|modify|alter|transform|adjust|replace|remove|add|convert|turn this into|make it|make this|redraw)\b/i,
    /\b(background|filter|style|color|saturation|brightness|clothing|hair|lighting)\b/i,
    /\b(make the|change the|remove the|add a|replace the)\b/i
  ]

  return editPatterns.some(pattern => pattern.test(p))
}

/**
 * Normalizes an image data string into mimeType and pure base64 data.
 */
export function parseImageData(raw: string, defaultMime = 'image/png'): { mimeType: string; data: string } {
  if (!raw) return { mimeType: defaultMime, data: '' }
  if (raw.startsWith('data:')) {
    const semi = raw.indexOf(';')
    const comma = raw.indexOf(',')
    if (semi > 5 && comma > semi) {
      const mimeType = raw.slice(5, semi)
      const data = raw.slice(comma + 1)
      return { mimeType, data }
    }
  }
  return { mimeType: defaultMime, data: raw }
}

/**
 * Generates or edits an image using Gemini's native image generation models.
 */
export async function generateOrEditImage(
  apiKey: string,
  prompt: string,
  options?: {
    inputImage?: ImageAttachment
    model?: string
    userId?: string
  }
): Promise<GeneratedImageResult> {
  const client = new GoogleGenAI({ apiKey })

  const candidateModels: string[] = []
  if (options?.model && (GEMINI_IMAGE_MODELS as readonly string[]).includes(options.model)) {
    candidateModels.push(options.model)
  }
  for (const m of GEMINI_IMAGE_MODELS) {
    if (!candidateModels.includes(m)) {
      candidateModels.push(m)
    }
  }

  const isEdit = Boolean(options?.inputImage?.data)

  // Build request contents
  let contents: any
  if (isEdit && options?.inputImage) {
    const { mimeType, data } = parseImageData(options.inputImage.data, options.inputImage.mimeType)
    contents = [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'image/png',
              data
            }
          },
          { text: prompt }
        ]
      }
    ]
  } else {
    contents = prompt
  }

  let lastError: any = null

  for (const model of candidateModels) {
    try {
      console.log(`[Image Generation] Attempting generation with model ${model}...`)
      const response = await client.models.generateContent({
        model,
        contents
      })

      const candidate = response.candidates?.[0]
      const parts = candidate?.content?.parts || []

      let foundImage: { mimeType: string; data: string } | null = null
      let textOutput = ''

      for (const part of parts) {
        if (part.text) {
          textOutput += part.text
        } else if (part.inlineData) {
          foundImage = {
            mimeType: part.inlineData.mimeType || 'image/png',
            data: part.inlineData.data || ''
          }
        }
      }

      if (foundImage && foundImage.data) {
        console.log(`[Image Generation] Successfully generated image with ${model}!`)

        // Persist to images table so it has a permanent URL
        let imageId = `img_${Date.now()}`
        let imageUrl = `data:${foundImage.mimeType};base64,${foundImage.data}`

        if (options?.userId) {
          try {
            const buffer = Buffer.from(foundImage.data, 'base64')
            const { data: dbImage, error: dbErr } = await supabase
              .from('images')
              .insert({
                user_id: options.userId,
                mime: foundImage.mimeType,
                size: buffer.length,
                data: foundImage.data
              })
              .select('id')
              .single()

            if (!dbErr && dbImage?.id) {
              imageId = dbImage.id
              imageUrl = `/api/images/${dbImage.id}`
            }
          } catch (dbSaveErr) {
            console.warn('[Image Generation] Could not save to images table, falling back to data URL:', dbSaveErr)
          }

          // Log AI usage if tokens available
          if (response.usageMetadata) {
            void settings.logAiUsage({
              userId: options.userId,
              provider: 'gemini',
              model,
              taskType: isEdit ? 'image_edit' : 'image_gen',
              promptTokens: response.usageMetadata.promptTokenCount || 0,
              candidateTokens: response.usageMetadata.candidatesTokenCount || 0,
              totalTokens: response.usageMetadata.totalTokenCount || 0
            })
          }
        }

        return {
          imageUrl,
          imageId,
          mimeType: foundImage.mimeType,
          base64Data: foundImage.data,
          text: textOutput.trim() || undefined,
          modelUsed: model,
          prompt,
          isEdit
        }
      }

      // If no image part returned, model might have returned text explaining it cannot
      if (textOutput) {
        console.warn(`[Image Generation] Model ${model} returned text without image: ${textOutput.slice(0, 100)}`)
      }
    } catch (err: any) {
      lastError = err
      const msg = err?.message || String(err)
      console.warn(`[Image Generation] Model ${model} failed: ${msg.slice(0, 120)}`)
      // Continue to next candidate model in waterfall
    }
  }

  throw lastError || new Error('All image generation models failed to generate an image.')
}
