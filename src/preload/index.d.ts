import { PosApi } from './index'

declare global {
  interface Window {
    api: PosApi
  }
}
