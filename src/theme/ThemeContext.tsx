import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ThemeId = 'midnight-violet' | 'aurora' | 'mono' | 'sunset'

interface Palette {
  id: ThemeId
  label: string
  /** Colors applied to `:root` as `--wp-*`. */
  vars: Record<string, string>
  /** One-color preview swatch used in the Settings tile. */
  swatch: string
}

export const THEME_PALETTES: Palette[] = [
  {
    id: 'midnight-violet',
    label: 'Midnight Violet',
    swatch: '#6E5DBB',
    vars: {
      '--wp-bg': '#0A0A10',
      '--wp-surface': '#13131A',
      '--wp-surface-2': '#1A1A22',
      '--wp-border': '#2A2A36',
      '--wp-accent': '#6E5DBB',
      '--wp-accent-hi': '#8B7FD6',
      '--wp-text': '#F4F3F8',
      '--wp-muted': '#8C8A99',
    },
  },
  {
    id: 'aurora',
    label: 'Aurora',
    swatch: '#38bdf8',
    vars: {
      '--wp-bg': '#071018',
      '--wp-surface': '#0D1A26',
      '--wp-surface-2': '#132331',
      '--wp-border': '#1F3646',
      '--wp-accent': '#38BDF8',
      '--wp-accent-hi': '#67E8F9',
      '--wp-text': '#ECFEFF',
      '--wp-muted': '#7FA6BD',
    },
  },
  {
    id: 'mono',
    label: 'Mono',
    swatch: '#CBD5E1',
    vars: {
      '--wp-bg': '#050506',
      '--wp-surface': '#0E0E10',
      '--wp-surface-2': '#18181B',
      '--wp-border': '#27272A',
      '--wp-accent': '#E4E4E7',
      '--wp-accent-hi': '#FAFAFA',
      '--wp-text': '#F4F4F5',
      '--wp-muted': '#71717A',
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    swatch: '#FB7185',
    vars: {
      '--wp-bg': '#110610',
      '--wp-surface': '#1A0B18',
      '--wp-surface-2': '#22101F',
      '--wp-border': '#391B30',
      '--wp-accent': '#FB7185',
      '--wp-accent-hi': '#FDBA74',
      '--wp-text': '#FFF1F2',
      '--wp-muted': '#B87A87',
    },
  },
]

interface ThemeState {
  themeId: ThemeId
  setTheme: (id: ThemeId) => void
  palettes: Palette[]
}

const ThemeCtx = createContext<ThemeState | null>(null)
const STORAGE_KEY = 'wordplay:theme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (saved && THEME_PALETTES.some((p) => p.id === saved)) return saved as ThemeId
    return 'midnight-violet'
  })

  useEffect(() => {
    const palette = THEME_PALETTES.find((p) => p.id === themeId) ?? THEME_PALETTES[0]
    const root = document.documentElement
    for (const [k, v] of Object.entries(palette.vars)) {
      root.style.setProperty(k, v)
    }
    root.dataset.theme = themeId
    try {
      localStorage.setItem(STORAGE_KEY, themeId)
    } catch {
      /* ignore quota */
    }
  }, [themeId])

  const setTheme = useCallback((id: ThemeId) => setThemeId(id), [])

  const value = useMemo<ThemeState>(
    () => ({ themeId, setTheme, palettes: THEME_PALETTES }),
    [themeId, setTheme],
  )

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
