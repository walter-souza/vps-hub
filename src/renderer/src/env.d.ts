import type { VpsApi } from '../../shared/types'

declare global {
  interface Window {
    vpsApi: VpsApi
  }
}
