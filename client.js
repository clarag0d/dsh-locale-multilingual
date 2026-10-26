/**
 * dsh-locale-multilingual —— 瀏覽器半端（多語言包）
 * ============================================================================
 *
 * client bundle 不是 ESM，是自註冊腳本：
 *     window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => ({...}) })
 *   id 必須等於 package.json 的 name，否則活下來卻不登記。
 *
 * 提供四種語言：繁體中文（zh-TW）、日本語（ja）、한국어（ko）、Français（fr）。
 *
 * 覆蓋範圍的一致性由機制保證，而不是靠人工比對：
 *   · 四種語言用的是**同一批輸入** —— 同樣的 namespace、同樣的 key、
 *     同樣的介面白名單字串，一次送進宿主的 /pack；
 *   · 宿主回傳的字典 key 集合與輸入完全一致（翻譯只換值，不動 key）；
 *   · 客戶端註冊前再比對一次 key 集合，任何缺失都會記進診斷日誌。
 *   所以不會「多翻」也不會「少翻」。
 *
 * 三條通道與繁中版完全一樣：
 *   ① 詞典註冊（locale 服務的 register）
 *   ② 標題欄菜單（[data-dsh-windows-menu]，精確標記）
 *   ③ 介面白名單（ui-strings.json，逐字精確匹配；內容永不命中）
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-locale-multilingual',
  factory: () => {
    const ENDPOINT = '/api/locale-multilingual'

    /** 提供的語言。zh-TW 走字形轉換，其餘由宿主調 API 翻譯。 */
    const LOCALES = [
      { id: 'zh-TW', label: '繁體中文', fallback: 'zh' },
      { id: 'ja', label: '日本語', fallback: 'en' },
      { id: 'ko', label: '한국어', fallback: 'en' },
      { id: 'fr', label: 'Français', fallback: 'en' },
    ]

    /** 標題欄那幾個字也算介面文案，一起送翻，保證各語言一致。 */
    const CHROME_STRINGS = ['应用', '编辑', '应用菜单']

    function report(message) {
      try {
        fetch(ENDPOINT + '/log', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: String(message) }),
        }).catch(() => {})
      } catch (err) {}
    }

    /* ────────────────────────── ① 詞典收集 ────────────────────────── */

    const captured = new Map() // namespace -> zh 字典
    const registered = new Map() // locale id -> Set(namespace)
    const localeTexts = new Map() // locale id -> Map(原文 -> 譯文)
    const built = new Set() // 已經建好的語言

    function seedFromService(locale) {
      const dicts = locale && locale.dicts
      if (!dicts || typeof dicts.forEach !== 'function') return false
      dicts.forEach((locales, ns) => {
        const zh = locales && typeof locales.get === 'function' ? locales.get('zh') : undefined
        if (zh && typeof zh === 'object' && !captured.has(ns)) captured.set(ns, zh)
      })
      return true
    }

    /* ────────────────────────── ② 標題欄 ────────────────────────── */

    function textFor(id, source, fallbackMap) {
      const map = localeTexts.get(id)
      if (map && map.has(source)) return map.get(source)
      return fallbackMap ? fallbackMap(source) : source
    }

    /**
     * 收集 document 與所有「開放」shadow root（遞迴）。
     *
     * 為什麼需要：標題欄菜單（[data-dsh-windows-menu]）和一部分面板掛在
     * shadow DOM 裡。只在 document 上 querySelector / 只走 document.body 的
     * TreeWalker，會讓「標題欄」和「白名單文案」兩條通道整個失效——而詞典
     * 那條通道照樣工作，所以看起來像「只有一部分沒翻」。
     */
    let rootsCache = { list: null, at: 0 }
    function collectRoots() {
      const now = Date.now()
      if (rootsCache.list && now - rootsCache.at < 4000) return rootsCache.list
      const roots = []
      try {
        if (!document) return roots
        roots.push(document)
        const queue = [document]
        let budget = 30000
        while (queue.length && budget > 0) {
          const root = queue.shift()
          let all
          try { all = root.querySelectorAll('*') } catch (err) { continue }
          for (const el of all) {
            if (--budget <= 0) break
            const shadow = el.shadowRoot
            if (shadow && roots.indexOf(shadow) < 0) {
              roots.push(shadow)
              queue.push(shadow)
            }
          }
        }
      } catch (err) {}
      rootsCache = { list: roots, at: now }
      return roots
    }

    let titlebarLog = ''
    function logOnce(message) {
      if (message === titlebarLog) return
      titlebarLog = message
      report(message)
    }

    let titlebarState = { app: '', edit: '', menu: '', active: '' }
    function syncTitlebar(locale) {
      try {
        if (!document || !locale || typeof locale.getSnapshot !== 'function') return
        const active = String((locale.getSnapshot() || {}).active || '')
        if (!LOCALES.some((item) => item.id === active)) return

        const pick = (source, zhTw, english) => {
          if (active === 'zh-TW') return zhTw
          if (active === 'zh') return source
          if (active === 'en') return english
          return textFor(active, source, () => source)
        }
        const app = pick('应用', '應用', 'Application')
        const edit = pick('编辑', '編輯', 'Edit')
        const menu = pick('应用菜单', '應用選單', 'Application menu')

        let host = null
        for (const root of collectRoots()) {
          try { host = root.querySelector('[data-dsh-windows-menu]') } catch (err) { host = null }
          if (host) break
        }
        if (!host) { logOnce('titlebar: 菜單元素未找到（shadow 掃描 ' + collectRoots().length + ' 個 root）'); return }

        const root = host.shadowRoot || host
        const setText = (el, value) => {
          if (!el || !value || el.textContent === value) return
          el.textContent = value
        }
        setText(root.querySelector('[data-menu="application"]'), app)
        setText(root.querySelector('[data-menu="edit"]'), edit)
        const bar = root.querySelector('[aria-label]')
        if (bar && menu && bar.getAttribute('aria-label') !== menu) bar.setAttribute('aria-label', menu)

        titlebarState = { app, edit, menu, active }
        logOnce('titlebar: 已套用 active=' + active + ' app=' + app + ' edit=' + edit +
          ' shadow=' + (host.shadowRoot ? 'open' : 'none'))
      } catch (err) {}
    }

    /* ────────────────────────── ③ 介面白名單替換 ────────────────────────── */

    const SKIP_TEXT = '[data-conversation-scroll],[data-zh-tw-skip],pre,code,' +
      'script,style,noscript,textarea,select,[contenteditable=""],[contenteditable="true"]'
    const SKIP_ATTR = '[data-zh-tw-skip],pre,code,script,style,[contenteditable=""],[contenteditable="true"]'
    const ATTRS = ['placeholder', 'title', 'aria-label']
    const CJK = /[\u3400-\u9fff\uf900-\ufaff]/

    let activeLocale = ''
    let uiObserver = null
    let uiTimer = 0

    function activeMap() {
      return localeTexts.get(activeLocale) || null
    }

    function rewriteTextNode(node, map) {
      const raw = node.nodeValue
      if (!raw || !CJK.test(raw)) return false
      const parent = node.parentElement
      if (!parent || (parent.closest && parent.closest(SKIP_TEXT))) return false
      const key = raw.trim()
      if (!key) return false
      const converted = map.get(key)
      if (!converted || converted === key) return false
      const at = raw.indexOf(key)
      if (at < 0) return false
      const next = raw.slice(0, at) + converted + raw.slice(at + key.length)
      if (next === raw) return false
      node.nodeValue = next
      return true
    }

    function rewriteAttributes(el, map) {
      if (!el.getAttribute) return false
      if (el.closest && el.closest(SKIP_ATTR)) return false
      let changed = false
      for (const name of ATTRS) {
        const raw = el.getAttribute(name)
        if (!raw || !CJK.test(raw)) continue
        const key = raw.trim()
        const converted = map.get(key)
        if (!converted || converted === key) continue
        const at = raw.indexOf(key)
        if (at < 0) continue
        el.setAttribute(name, raw.slice(0, at) + converted + raw.slice(at + key.length))
        changed = true
      }
      return changed
    }

    let uiLog = ''
    function applyUi() {
      const map = activeMap()
      if (!map || !map.size || !document) return
      const roots = collectRoots()
      let replaced = 0
      for (const root of roots) {
        if (!root || typeof root.querySelectorAll !== 'function') continue
        try {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          let node
          while ((node = walker.nextNode())) { if (rewriteTextNode(node, map)) replaced++ }
        } catch (err) {}
        try {
          const attrWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
          let el
          while ((el = attrWalker.nextNode())) { if (rewriteAttributes(el, map)) replaced++ }
        } catch (err) {}
      }
      const message = 'ui: roots=' + roots.length + ' replaced=' + replaced +
        ' active=' + activeLocale + ' map=' + map.size
      if (message !== uiLog) {
        uiLog = message
        report(message)
      }
    }

    function scheduleUi() {
      if (uiTimer) clearTimeout(uiTimer)
      uiTimer = setTimeout(() => {
        uiTimer = 0
        applyUi()
      }, 250)
    }

    function startUiObserver(onDispose) {
      if (typeof MutationObserver === 'undefined' || !document || !document.body) return
      try {
        uiObserver = new MutationObserver(() => scheduleUi())
        uiObserver.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ATTRS,
        })
        onDispose(() => {
          try { if (uiObserver) uiObserver.disconnect() } catch (err) {}
          uiObserver = null
        })
      } catch (err) {
        report('ui observer failed: ' + (err && err.message ? err.message : String(err)))
      }
    }

    /* ────────────────────────── 啟動 ────────────────────────── */

    return {
      inject: ['locale'],
      apply(ctx) {
        const locale = ctx.locale
        if (!locale || typeof locale.addLanguage !== 'function') {
          report('ctx.locale unavailable; language pack disabled')
          return
        }

        const disposers = []
        const extraCleanup = []
        let busy = false
        let queued = false
        let timer = 0

        // ── 掛語言 ──
        for (const item of LOCALES) {
          try {
            const remove = locale.addLanguage({ id: item.id, label: item.label, fallback: item.fallback })
            if (typeof remove === 'function') disposers.push(remove)
          } catch (err) {
            report('addLanguage ' + item.id + ' failed: ' + (err && err.message ? err.message : String(err)))
          }
        }
        report('languages registered: ' + LOCALES.map((l) => l.id).join(','))

        // ── 詞典收集（含之後才註冊的）──
        const seeded = seedFromService(locale)
        report('seed from locale.dicts: ' + (seeded ? 'available' : 'unavailable') + ', ' + captured.size + ' namespaces')

        if (!seeded) {
          try {
            const original = locale.register
            if (typeof original === 'function') {
              locale.register = function patchedRegister(ns, localeOrDicts, dict) {
                const result = original.call(locale, ns, localeOrDicts, dict)
                try {
                  if (typeof localeOrDicts === 'string') {
                    if (localeOrDicts.toLowerCase() === 'zh' && dict && !captured.has(ns)) captured.set(ns, dict)
                  } else if (localeOrDicts && typeof localeOrDicts === 'object') {
                    const zh = localeOrDicts.zh
                    if (zh && typeof zh === 'object' && !captured.has(ns)) captured.set(ns, zh)
                  }
                } catch (err) {}
                schedule('late-register')
                return result
              }
              report('register hook installed')
            }
          } catch (err) {
            report('register hook failed: ' + (err && err.message ? err.message : String(err)))
          }
        }

        // ── 白名單原文（只取一次，四種語言共用同一批）──
        let whitelist = null
        async function loadWhitelist() {
          if (whitelist) return whitelist
          try {
            const response = await fetch(ENDPOINT + '/ui-strings', { headers: { accept: 'application/json' } })
            if (!response.ok) {
              report('ui-strings unavailable: HTTP ' + response.status)
              whitelist = []
              return whitelist
            }
            const list = await response.json()
            whitelist = Array.isArray(list) ? list : []
          } catch (err) {
            report('ui-strings load error: ' + (err && err.message ? err.message : String(err)))
            whitelist = []
          }
          return whitelist
        }

        /**
         * 等詞條「註冊完」再開始建包。
         *
         * 為什麼要等：locale 服務裡的詞典是各套件在啟動過程中陸續註冊的。
         * 之前一開機就建包，只抓到 2 個 namespace，於是把「大部分界面」
         * 都留空 —— 選了日文也還是英文。這裡等到捕獲數量在 quietMs 內不再
         * 增長再繼續，最多等 maxMs。
         */
        async function waitForStableCapture(quietMs, maxMs) {
          const quiet = quietMs || 900
          const limit = maxMs || 20000
          const start = Date.now()
          let last = -1
          let stableSince = Date.now()
          while (Date.now() - start < limit) {
            seedFromService(locale)
            if (captured.size !== last) {
              last = captured.size
              stableSince = Date.now()
            } else if (Date.now() - stableSince >= quiet) {
              return
            }
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
        }

        /** 為一種語言建語料包；只送「這一語言還沒有的 namespace」（增量）。 */
        async function buildLocale(id) {
          const texts = await loadWhitelist()
          const seen = registered.get(id) || new Set()
          const pending = {}
          for (const [ns, dict] of captured) if (!seen.has(ns)) pending[ns] = dict
          const pendingCount = Object.keys(pending).length
          if (pendingCount === 0 && built.has(id)) return

          const allTexts = texts.concat(CHROME_STRINGS)
          const response = await fetch(ENDPOINT + '/pack', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ target: id, dicts: pending, texts: allTexts }),
          })
          if (!response.ok) {
            const detail = await response.text().catch(() => '')
            report('pack ' + id + ' HTTP ' + response.status + ' ' + detail.slice(0, 160))
            return
          }
          const data = await response.json()
          if (!data || !data.ok) {
            report('pack ' + id + ' rejected: ' + JSON.stringify(data).slice(0, 200))
            return
          }

          // 覆蓋範圍校驗：key 集合必須與輸入完全一致（不多不少）
          let missing = 0
          let extra = 0
          for (const [ns, dict] of Object.entries(pending)) {
            const got = (data.dicts && data.dicts[ns]) || null
            if (!got) { missing += Object.keys(dict).length; continue }
            for (const key of Object.keys(dict)) if (!(key in got)) missing++
            for (const key of Object.keys(got)) if (!(key in dict)) extra++
          }
          if (missing || extra) {
            report('pack ' + id + ' key mismatch: missing=' + missing + ' extra=' + extra)
          }

          for (const ns of Object.keys(data.dicts || {})) {
            if (seen.has(ns)) continue
            try {
              const remove = locale.register(ns, id, data.dicts[ns])
              if (typeof remove === 'function') disposers.push(remove)
              seen.add(ns)
            } catch (err) {
              report('register ' + id + '/' + ns + ' failed: ' + (err && err.message ? err.message : String(err)))
            }
          }
          registered.set(id, seen)

          const map = localeTexts.get(id) || new Map()
          for (const [source, translated] of Object.entries(data.texts || {})) {
            if (typeof translated === 'string' && translated && translated !== source) map.set(source, translated)
          }
          localeTexts.set(id, map)
          built.add(id)
          report('pack ' + id + ' ready: +' + pendingCount + ' namespaces (' + seen.size + ' total), ' +
            map.size + ' ui strings' +
            (data.cached ? ' (host cache)' : ' (' + (data.took || 0) + 'ms, failed ' + (data.failed || 0) + ')'))

          if (id === activeLocale) {
            scheduleUi()
            selfCheck(id)
          }
        }

        /** 端到端自檢：用 locale 服務自己的 bind() 查一個已知 key，確認真的解析到該語言。 */
        function selfCheck(id) {
          try {
            if (typeof locale.bind !== 'function') return
            const active = String((locale.getSnapshot() || {}).active || '')
            const t = locale.bind('common')
            const sample = typeof t === 'function' ? t('ok') : '(no fn)'
            report('selfcheck: want=' + id + ' active=' + active + ' common.ok=' + JSON.stringify(sample) +
              ' namespaces=' + ((registered.get(id) || new Set()).size))
          } catch (err) {
            report('selfcheck failed: ' + (err && err.message ? err.message : String(err)))
          }
        }

        async function buildAll(reason) {
          if (busy) { queued = true; return }
          busy = true
          try {
            await waitForStableCapture()
            seedFromService(locale)
            for (const item of LOCALES) {
              try {
                await buildLocale(item.id)
              } catch (err) {
                report('build ' + item.id + ' error: ' + (err && err.message ? err.message : String(err)))
              }
            }
            selfCheck(activeLocale || '')
            report('build pass done (' + reason + '), captured=' + captured.size + ', ready: ' + [...built].join(','))
          } finally {
            busy = false
            if (queued) { queued = false; schedule('queued') }
          }
        }

        function schedule(reason) {
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            timer = 0
            buildAll(reason)
          }, 300)
        }

        // ── 啟動 ──
        schedule('boot')
        try {
          const unsubscribe = locale.subscribe(() => {
            const active = String((locale.getSnapshot() || {}).active || '')
            if (active && active !== activeLocale) {
              activeLocale = active
              scheduleUi()
              syncTitlebar(locale)
              // 切換語言時立刻自檢一次：日誌裡能直接看到「該語言解析成什麼」
              selfCheck(active)
            }
            schedule('change')
          })
          if (typeof unsubscribe === 'function') disposers.push(unsubscribe)
        } catch (err) {
          report('subscribe failed: ' + (err && err.message ? err.message : String(err)))
        }

        // 目前語言（可能啟動時就已經是我們的語言之一）
        try { activeLocale = String((locale.getSnapshot() || {}).active || '') } catch (err) {}

        syncTitlebar(locale)
        startUiObserver((fn) => extraCleanup.push(fn))
        scheduleUi()

        /**
         * 定期補掃。
         *
         * 標題欄和部分面板是啟動之後才掛上的（有時比我們的 apply 晚），
         * 而 shadow root 也不會觸發我們掛在 document.body 上的 MutationObserver。
         * 所以除了事件驅動，再加一條低頻兜底：只要還沒套用成功、或語言變了、
         * 或頁面剛渲染出新東西，下一輪就會補上。
         */
        let tickCount = 0
        const tickId = setInterval(() => {
          try {
            tickCount++
            if (tickCount % 3 === 0) rootsCache = { list: null, at: 0 } // 約每 4.5 秒重掃一次 shadow root
            syncTitlebar(locale)
            applyUi()
          } catch (err) {}
        }, 1500)
        extraCleanup.push(() => clearInterval(tickId))

        if (typeof ctx.effect === 'function') {
          ctx.effect(() => () => {
            if (timer) clearTimeout(timer)
            if (uiTimer) clearTimeout(uiTimer)
            for (const dispose of extraCleanup.splice(0)) { try { dispose() } catch (err) {} }
            for (const dispose of disposers.splice(0)) { try { dispose() } catch (err) {} }
          }, 'dsh-locale-multilingual: 語言包')
        }
      },
    }
  },
})
