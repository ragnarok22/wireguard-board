import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear()
})
afterEach(() => {
  if (typeof document !== 'undefined') cleanup()
  vi.unstubAllGlobals()
})
