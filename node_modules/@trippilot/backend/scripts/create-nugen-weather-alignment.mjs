import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const apiKey = process.env.NUGEN_API_KEY
if (!apiKey) throw new Error('Set NUGEN_API_KEY in the environment before starting an alignment.')
const corpusPath = resolve(dirname(fileURLToPath(import.meta.url)), '../data/voyara-weather-alignment.txt')
const corpus = await readFile(corpusPath)
const form = new FormData()
form.append('files', new Blob([corpus], { type: 'text/plain' }), basename(corpusPath))
form.append('categories', JSON.stringify(['hospitality-travel', 'weather-impact', 'voyara']))
form.append('names', JSON.stringify(['Voyara weather impact alignment corpus']))

async function post(path, body) {
  const response = await fetch(`https://api.nugen.in/api/v3${path}`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body })
  const text = await response.text()
  if (!response.ok) throw new Error(`Nugen ${path} failed (${response.status}): ${text}`)
  return text ? JSON.parse(text) : {}
}

let documentIds = process.env.NUGEN_DOCUMENT_IDS?.split(',').map(id => id.trim()).filter(Boolean)
if (!documentIds?.length) {
  const upload = await post('/documents/create', form)
  documentIds = upload.document_ids ?? upload.documents?.map(document => document.document_id ?? document.id)
}
if (!Array.isArray(documentIds) || documentIds.length === 0) throw new Error(`Nugen did not return document_ids: ${JSON.stringify(upload)}`)
console.log('Uploaded corpus. Confirm its document status is READY in Nugen before alignment:', documentIds.join(', '))
console.log('Wait for the upload to become READY, then run the alignment request below (Nugen snapshots documents at creation).')
console.log(`Document IDs: ${JSON.stringify(documentIds)}`)

if (process.env.NUGEN_CREATE_ALIGNMENT !== 'true') {
  console.log('Set NUGEN_CREATE_ALIGNMENT=true and rerun after documents are READY to create the alignment project.')
  process.exit(0)
}

const result = await post('/alignment-projects/create', JSON.stringify({
  alignment_name: 'Voyara Hospitality Weather Impact Twin',
  base_model_id: process.env.NUGEN_BASE_MODEL_ID || 'qwen-v2p5-0p5b-instruct',
  document_ids: documentIds,
  description: 'Domain alignment for probabilistic weather disruption and cascading itinerary impact inference in Voyara.',
}))
console.log('Alignment started:', JSON.stringify(result))
console.log('Poll GET https://api.nugen.in/api/v3/alignment-projects/' + result.alignment_id + '/status until COMPLETED; then set NUGEN_ALIGNED_MODEL_ID to its model_id and deploy it in Nugen.')
