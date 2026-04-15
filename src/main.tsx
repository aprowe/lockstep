import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { store } from './store/store'
import './index.css'
import App from './App'
import { ProjectProvider } from './context/ProjectContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <ProjectProvider>
        <App />
      </ProjectProvider>
    </Provider>
  </StrictMode>,
)
