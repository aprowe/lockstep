import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { store } from './store/store'
import { initUiScale } from './uiScale'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
// Side-effect import: registers the core assistant extension so its tools
// are visible the first time the panel runs a query.
import './assistant'

initUiScale()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Provider store={store}>
        <App />
      </Provider>
    </ErrorBoundary>
  </StrictMode>,
)
