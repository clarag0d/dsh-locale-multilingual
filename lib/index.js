/**
 * dsh-locale-multilingual —— 宿主半端（多語言包 · 純本地）
 * ============================================================================
 *
 * 不調用任何外部 API。四種語言的語料都來自磁碟上的本地文件：
 *
 *   zh-TW   → 運行時用 OpenCC（cn → twp）字形轉換，離線、確定性
 *   ja/ko/fr → 直接讀 lang/<locale>.json（打包在插件裡）
 *
 * 為什麼繁中不預生成、其餘預生成：繁中只是字形轉換，算一次 80ms、結果確定；
 * 韓日法必須真翻譯，只能預先翻好放進文件。兩者走同一條 /pack 介面，
 * 客戶端不需要知道差別。
 *
 * 本地文件格式（lang/<locale>.json）：
 *   {
 *     "dicts": { "<namespace>": { "<key>": "<譯文>" } },
 *     "texts": { "<簡中原字串>": "<譯文>" }
 *   }
 * 覆蓋範圍必須與繁中完全一致：同樣的 namespace、同樣的 key、同樣的界面白名單。
 *
 * 對外介面（都掛在 /api/locale-multilingual 下）：
 *   GET  /status        健康狀態（各語言文件是否就緒）
 *   GET  /ui-strings    介面白名單原文
 *   POST /log           前端診斷日誌
 *   POST /pack          { target, dicts, texts } → 該語言的語料包
 *   POST /convert       舊介面：只做 zh-TW 詞典轉換
 *   POST /convert-texts 舊介面：只做 zh-TW 字串轉換
 * ============================================================================
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as OpenCC from 'opencc-js'

const PREFIX = '/api/locale-multilingual'
const DATA_DIR = path.join(homedir(), '.dsh', 'locale-multilingual')
const CACHE_DIR = path.join(DATA_DIR, 'cache')
const LOG_FILE = path.join(DATA_DIR, 'diagnostic.log')
const UI_STRINGS_FILE = fileURLToPath(new URL('../ui-strings.json', import.meta.url))
const LANG_DIR = fileURLToPath(new URL('../lang/', import.meta.url))
const BODY_LIMIT = 16 * 1024 * 1024

/** 語言設定：zh-TW 走字形轉換，其餘讀本地文件。 */
const LANGUAGES = {
  'zh-TW': { engine: 'opencc', name: '繁體中文' },
  ja: { engine: 'local', name: '日本語' },
  ko: { engine: 'local', name: '한국어' },
  fr: { engine: 'local', name: 'Français' },
}

let converter = null
function convert() {
  if (!converter) converter = OpenCC.Converter({ from: 'cn', to: 'twp' })
  return converter
}

function ensureDir(dir) {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  } catch (err) {}
}

function log(message) {
  try {
    ensureDir(DATA_DIR)
    appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + message + '\n')
  } catch (err) {}
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, code, value) {
  const body = JSON.stringify(value)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function hashOf(value) {
  try {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
  } catch (err) {
    return ''
  }
}

/* ────────────────────── 本地語言文件 ────────────────────── */

const localPacks = new Map() // locale -> { pack, stamp }

/** 讀取並快取 lang/<locale>.json；文件改了（mtime 變）會自動重讀。 */
function loadLocalPack(target) {
  const file = path.join(LANG_DIR, target + '.json')
  if (!existsSync(file)) return null
  let stamp = 0
  try { stamp = statSync(file).mtimeMs } catch (err) {}
  const cached = localPacks.get(target)
  if (cached && cached.stamp === stamp) return cached.pack
  try {
    const pack = JSON.parse(readFileSync(file, 'utf8'))
    if (!pack || typeof pack !== 'object' || !pack.dicts) return null
    localPacks.set(target, { pack, stamp })
    log('local pack ' + target + ': loaded ' + Object.keys(pack.dicts).length + ' namespaces')
    return pack
  } catch (err) {
    log('local pack ' + target + ' unreadable: ' + (err && err.message))
    return null
  }
}

/* ────────────────────── zh-TW：OpenCC ────────────────────── */

function convertDicts(dicts) {
  const c = convert()
  const out = {}
  let keys = 0
  for (const [ns, dict] of Object.entries(dicts || {})) {
    if (!dict || typeof dict !== 'object') continue
    const converted = {}
    for (const [key, value] of Object.entries(dict)) {
      if (typeof value === 'string') {
        converted[key] = c(value)
        keys++
      } else {
        converted[key] = value
      }
    }
    out[ns] = converted
  }
  return { out, keys }
}

function convertTexts(texts) {
  const c = convert()
  const out = {}
  for (const text of texts || []) {
    if (typeof text !== 'string') continue
    out[text] = c(text)
  }
  return out
}

/* ────────────────────── 語料包 ────────────────────── */

function buildPack(target, dicts, texts) {
  const spec = LANGUAGES[target]
  if (!spec) throw new Error('unsupported target ' + target)
  const started = Date.now()

  if (spec.engine === 'opencc') {
    const conv = convertDicts(dicts)
    return {
      dicts: conv.out,
      texts: convertTexts(texts),
      failed: 0,
      took: Date.now() - started,
      cached: false,
    }
  }

  const pack = loadLocalPack(target)
  if (!pack) throw new Error('lang/' + target + '.json is missing')

  // 只回傳客戶端要的那幾個 namespace，避免整個文件塞進回應
  const outDicts = {}
  let missingNamespaces = 0
  for (const ns of Object.keys(dicts || {})) {
    const source = pack.dicts[ns]
    if (!source) { missingNamespaces++; continue }
    outDicts[ns] = source
  }
  const outTexts = {}
  for (const text of texts || []) {
    if (typeof text === 'string' && typeof pack.texts[text] === 'string') outTexts[text] = pack.texts[text]
  }
  if (missingNamespaces > 0) {
    log('local pack ' + target + ': ' + missingNamespaces + ' namespaces missing in file')
  }
  return {
    dicts: outDicts,
    texts: outTexts,
    failed: 0,
    took: Date.now() - started,
    cached: true,
    missingNamespaces,
  }
}

/* ────────────────────── 路由 ────────────────────── */

async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://localhost')
  const pathname = url.pathname

  if (req.method === 'GET' && pathname === PREFIX + '/status') {
    const status = {}
    for (const [id, spec] of Object.entries(LANGUAGES)) {
      if (spec.engine === 'opencc') { status[id] = 'builtin'; continue }
      const file = path.join(LANG_DIR, id + '.json')
      status[id] = existsSync(file) ? 'file' : 'missing'
    }
    return sendJson(res, 200, { ok: true, dataDir: DATA_DIR, languages: status })
  }

  if (req.method === 'GET' && pathname === PREFIX + '/ui-strings') {
    try {
      const body = readFileSync(UI_STRINGS_FILE, 'utf8')
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
      })
      return res.end(body)
    } catch (err) {
      log('ui-strings unavailable: ' + (err && err.message))
      return sendJson(res, 404, { ok: false, error: 'ui-strings.json missing' })
    }
  }

  if (req.method === 'POST' && pathname === PREFIX + '/log') {
    let payload = {}
    try { payload = JSON.parse(await readBody(req)) } catch (err) {}
    log('[client] ' + String(payload && payload.message))
    return sendJson(res, 200, { ok: true })
  }

  if (req.method === 'POST' && pathname === PREFIX + '/pack') {
    let payload = {}
    try {
      payload = JSON.parse(await readBody(req))
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: 'invalid json' })
    }
    const target = String((payload && payload.target) || '')
    if (!LANGUAGES[target]) return sendJson(res, 400, { ok: false, error: 'unsupported target' })
    const dicts = (payload && payload.dicts) || {}
    const texts = Array.isArray(payload && payload.texts) ? payload.texts : []
    if (typeof dicts !== 'object' || Array.isArray(dicts)) {
      return sendJson(res, 400, { ok: false, error: 'dicts must be an object' })
    }
    try {
      const built = buildPack(target, dicts, texts)
      log('pack ' + target + ': ' + Object.keys(built.dicts).length + ' namespaces, ' +
        Object.keys(built.texts).length + ' texts, ' + built.took + 'ms' +
        (built.missingNamespaces ? ', missing ' + built.missingNamespaces : ''))
      return sendJson(res, 200, { ok: true, ...built })
    } catch (err) {
      log('pack ' + target + ' error: ' + (err && err.message ? err.message : String(err)))
      return sendJson(res, 500, { ok: false, error: String(err && err.message) })
    }
  }

  // ── 舊介面（只做 zh-TW）──
  if (req.method === 'POST' && pathname === PREFIX + '/convert') {
    let payload = {}
    try { payload = JSON.parse(await readBody(req)) } catch (err) {
      return sendJson(res, 400, { ok: false, error: 'invalid json' })
    }
    const dicts = payload && payload.dicts
    if (!dicts || typeof dicts !== 'object' || Array.isArray(dicts)) {
      return sendJson(res, 400, { ok: false, error: 'dicts must be an object' })
    }
    const key = hashOf(dicts)
    ensureDir(CACHE_DIR)
    const cacheFile = key ? path.join(CACHE_DIR, key + '.json') : ''
    if (cacheFile && existsSync(cacheFile)) {
      try {
        return sendJson(res, 200, { ok: true, cached: true, dicts: JSON.parse(readFileSync(cacheFile, 'utf8')) })
      } catch (err) {}
    }
    const { out, keys } = convertDicts(dicts)
    if (cacheFile) { try { writeFileSync(cacheFile, JSON.stringify(out), 'utf8') } catch (err) {} }
    return sendJson(res, 200, { ok: true, cached: false, dicts: out, keys })
  }

  if (req.method === 'POST' && pathname === PREFIX + '/convert-texts') {
    let payload = {}
    try { payload = JSON.parse(await readBody(req)) } catch (err) {
      return sendJson(res, 400, { ok: false, error: 'invalid json' })
    }
    const texts = payload && payload.texts
    if (!Array.isArray(texts)) return sendJson(res, 400, { ok: false, error: 'texts must be an array' })
    const map = convertTexts(texts)
    return sendJson(res, 200, { ok: true, map, computed: Object.keys(map).length, hits: 0 })
  }

  return sendJson(res, 404, { ok: false, error: 'not found' })
}

export function apply(ctx) {
  log('host apply: local-file mode, languages = ' + Object.keys(LANGUAGES).join(', '))
  ctx.inject(['webServer'], (child) => {
    const server = child.webServer
    if (!server || typeof server.register !== 'function') {
      log('webServer unavailable; routes not registered')
      return
    }
    child.effect(() => server.register({
      kind: 'prefix',
      path: PREFIX,
      handler: async (req, res) => {
        try {
          await handle(req, res)
        } catch (err) {
          log('handler error: ' + (err && err.message ? err.message : String(err)))
          try { sendJson(res, 500, { ok: false, error: String(err && err.message) }) } catch (inner) {}
        }
      },
    }))
  })
}
