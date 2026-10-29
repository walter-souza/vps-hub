import { createRoot } from 'react-dom/client'
import { App } from './App'
import './lib/monaco'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)
