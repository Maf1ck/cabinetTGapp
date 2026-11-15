// Кабінет нутриціолога для Windows: окреме вікно з адмінкою (/n) з Vercel.
// Сайт оновлюється сам з кожним деплоєм; оболонку перезбирати не треба.
//
// Посилання поза кабінетом (Telegram, Instagram, бот для входу) відкриваються в системі,
// а не всередині програми: вхід підтверджується в Telegram, як і з браузера.
import { app, BrowserWindow, Menu, screen, session, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const START_URL = new URL(process.env.CABINET_URL ?? 'https://cabinet-t-gapp.vercel.app/n')
const ORIGIN = START_URL.origin
const RETRY_URL = 'cabinet://retry'
// Перевірка без побічних дій: зовнішні посилання лише пишуться в лог, програма сама закривається
const SMOKE_MS = Number(process.env.CABINET_SMOKE_MS) || 0

const here = dirname(fileURLToPath(import.meta.url))
const ICON = join(here, 'build', 'icon.png')
const boundsFile = () => join(app.getPath('userData'), 'window.json')

const isAppUrl = (url) => {
  try {
    return new URL(url).origin === ORIGIN
  } catch {
    return false
  }
}

function openOutside(url) {
  if (!/^(https?|tg|mailto):/i.test(url)) return
  if (SMOKE_MS) console.log('external:', url)
  else void shell.openExternal(url)
}

// ---------- розмір і положення вікна між запусками ----------

function loadBounds() {
  try {
    const saved = JSON.parse(readFileSync(boundsFile(), 'utf8'))
    // монітор могли відключити: тоді відкриваємо за замовчуванням
    const area = screen.getDisplayMatching(saved).workArea
    const visible =
      saved.x < area.x + area.width && saved.x + saved.width > area.x && saved.y >= area.y && saved.y < area.y + area.height
    return visible ? saved : { maximized: saved.maximized }
  } catch {
    return {}
  }
}

function saveBounds(win) {
  try {
    writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }))
  } catch {
    // не вдалося записати — наступного разу просто відкриється стандартне вікно
  }
}

// ---------- вікно ----------

function createWindow() {
  const saved = loadBounds()
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    ...('x' in saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : {}),
    title: 'Кабінет нутриціолога',
    icon: ICON,
    backgroundColor: '#f6f9f5', // $bg-app кабінету: без білого спалаху до завантаження
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  })
  win.webContents.session.setSpellCheckerLanguages(['uk', 'en-US'])

  win.once('ready-to-show', () => {
    if (saved.maximized) win.maximize()
    win.show()
  })
  win.on('close', () => saveBounds(win))

  const { webContents } = win

  // Переходи в межах кабінету — тут; усе інше — у браузер або Telegram
  webContents.on('will-navigate', (event, url) => {
    if (url === RETRY_URL) {
      event.preventDefault()
      void win.loadURL(START_URL.href)
    } else if (!isAppUrl(url)) {
      event.preventDefault()
      openOutside(url)
    }
  })

  webContents.setWindowOpenHandler(({ url }) => {
    if (url && url !== 'about:blank') {
      if (isAppUrl(url)) void win.loadURL(url)
      else openOutside(url)
      return { action: 'deny' }
    }
    // Вхід з браузера спершу відкриває порожнє вікно, а потім веде його на t.me/<бот>
    // (так браузер не блокує вікно як спливне). Тут це невидима заглушка: перший її перехід
    // віддаємо системі, а саму закриваємо.
    return { action: 'allow', overrideBrowserWindowOptions: { show: false } }
  })

  webContents.on('did-create-window', (child) => {
    const forward = (event, url) => {
      event.preventDefault()
      openOutside(url)
      child.destroy()
    }
    child.webContents.on('will-navigate', forward)
    child.webContents.on('will-redirect', forward)
    // сайт так і не перейшов нікуди — прибираємо заглушку
    setTimeout(() => !child.isDestroyed() && child.destroy(), 30_000)
  })

  webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // -3: перехід скасовано (зокрема нами в will-navigate) — це не збій
    if (!isMainFrame || code === -3) return
    if (SMOKE_MS) console.log('fail:', code, description, url)
    void win.loadFile(join(here, 'offline.html'))
  })

  if (SMOKE_MS) {
    webContents.on('did-finish-load', () => console.log('loaded:', webContents.getURL(), '|', webContents.getTitle()))
    webContents.on('console-message', (event) => {
      if (event.level === 'error') console.log('console error:', event.message)
    })
  }

  void win.loadURL(START_URL.href)
  return win
}

const isMac = process.platform === 'darwin'

function buildMenu() {
  // Windows: рядок меню схований (з’являється на Alt); головне тут — гарячі клавіші.
  // macOS: перше меню стає меню програми у верхньому рядку (⌘R, ⌘H, ⌘M, ⌘Q).
  return Menu.buildFromTemplate([
    {
      label: 'Кабінет',
      submenu: [
        { label: 'Оновити', role: 'reload' },
        { label: 'Оновити повністю', role: 'forceReload' },
        { type: 'separator' },
        ...(isMac
          ? [
              { label: 'Сховати', role: 'hide' },
              { label: 'Згорнути', role: 'minimize' },
              { label: 'Закрити вікно', role: 'close' },
              { type: 'separator' },
            ]
          : []),
        { label: 'Вийти', role: 'quit' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Скасувати', role: 'undo' },
        { label: 'Повторити', role: 'redo' },
        { type: 'separator' },
        { label: 'Вирізати', role: 'cut' },
        { label: 'Копіювати', role: 'copy' },
        { label: 'Вставити', role: 'paste' },
        { label: 'Виділити все', role: 'selectAll' },
      ],
    },
    {
      label: 'Вигляд',
      submenu: [
        { label: 'Збільшити', role: 'zoomIn' },
        { label: 'Зменшити', role: 'zoomOut' },
        { label: 'Звичайний розмір', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'На весь екран', role: 'togglefullscreen' },
        { label: 'Інструменти розробника', role: 'toggleDevTools' },
      ],
    },
  ])
}

// ---------- запуск ----------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow = null

  // Повторний запуск (ярлик ще раз) — показуємо вже відкрите вікно
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.setAppUserModelId('ua.nknutrition.cabinet')

  void app.whenReady().then(() => {
    // Сайту потрібні лише сповіщення і буфер обміну; камера, мікрофон, геолокація — ні
    const allowed = new Set(['notifications', 'clipboard-sanitized-write', 'fullscreen'])
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)))

    Menu.setApplicationMenu(buildMenu())
    mainWindow = createWindow()
    mainWindow.on('closed', () => (mainWindow = null))

    if (SMOKE_MS) {
      // CABINET_SMOKE_SHOT=<файл.png> — знімок вікна перед закриттям
      const shot = process.env.CABINET_SMOKE_SHOT
      setTimeout(async () => {
        if (shot && mainWindow) writeFileSync(shot, (await mainWindow.webContents.capturePage()).toPNG())
        app.quit()
      }, SMOKE_MS)
    }
  })

  app.on('window-all-closed', () => app.quit())
}
