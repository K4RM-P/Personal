import { CustomerDisplayApi } from './customer-display'

declare global {
  interface Window {
    customerDisplayApi: CustomerDisplayApi
  }
}
