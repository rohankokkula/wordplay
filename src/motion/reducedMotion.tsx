import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { MotionConfig } from 'motion/react'

type ReducedMotionValue = {
  /** Prefer no animations? Driven by OS + in-app setting. */
  reduce: boolean
  /** User-overridable toggle. */
  setOverride: (v: 'auto' | 'on' | 'off') => void
  override: 'auto' | 'on' | 'off'
}

const Ctx = createContext<ReducedMotionValue | null>(null)
const STORAGE_KEY = 'wordplay:reduced-motion'

export function ReducedMotionProvider({ children }: { children: ReactNode }) {
  const [override, setOverrideState] = useState<'auto' | 'on' | 'off'>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (saved === 'on' || saved === 'off' || saved === 'auto') return saved
    return 'auto'
  })
  const [osReduce, setOsReduce] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const listener = (e: MediaQueryListEvent) => setOsReduce(e.matches)
    mq.addEventListener?.('change', listener)
    return () => mq.removeEventListener?.('change', listener)
  }, [])

  const value = useMemo<ReducedMotionValue>(() => {
    const reduce = override === 'on' ? true : override === 'off' ? false : osReduce
    return {
      reduce,
      override,
      setOverride: (v) => {
        setOverrideState(v)
        try {
          localStorage.setItem(STORAGE_KEY, v)
        } catch {
          /* ignore quota */
        }
      },
    }
  }, [override, osReduce])

  return (
    <Ctx.Provider value={value}>
      <MotionConfig reducedMotion={value.reduce ? 'always' : 'user'}>{children}</MotionConfig>
    </Ctx.Provider>
  )
}

export function useReducedMotionContext(): ReducedMotionValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    // Graceful degradation for tests / stories.
    return { reduce: false, override: 'auto', setOverride: () => {} }
  }
  return ctx
}
