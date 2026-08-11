import React from 'react'
import ReactDOM from 'react-dom/client'
import { CustomerDisplayApp } from './CustomerDisplayApp'
import '../index.css'
import './customerDisplay.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CustomerDisplayApp />
  </React.StrictMode>
)
