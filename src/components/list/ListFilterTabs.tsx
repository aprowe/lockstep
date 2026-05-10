import type { ListFilterMode } from '../../store/slices/listsSlice'
import { IconFilterAll, IconFilterView, IconFilterClip } from '../icons'
import './ListFilterTabs.css'

interface Props {
  mode: ListFilterMode
  onChange: (mode: ListFilterMode) => void
  hideClipOption?: boolean
  clipDisabled?: boolean
}

const ICONS: Record<ListFilterMode, React.ReactNode> = {
  global:   <IconFilterAll  size={15} />,
  viewport: <IconFilterView size={15} />,
  clip:     <IconFilterClip size={15} />,
}

const TITLES: Record<ListFilterMode, string> = {
  global:   'Show every item',
  viewport: 'Show items inside the current timeline view',
  clip:     'Show items inside the active clip',
}

export default function ListFilterTabs({ mode, onChange, hideClipOption, clipDisabled }: Props) {
  const options: ListFilterMode[] = hideClipOption
    ? ['global', 'viewport']
    : ['global', 'viewport', 'clip']
  return (
    <div className="list-filter-tabs" role="group" aria-label="Filter scope">
      {options.map(opt => {
        const disabled = opt === 'clip' && !!clipDisabled
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={mode === opt}
            disabled={disabled}
            className={`list-filter-tab${mode === opt ? ' list-filter-tab--active' : ''}`}
            title={TITLES[opt]}
            aria-label={TITLES[opt]}
            onClick={() => onChange(opt)}
          >
            {ICONS[opt]}
          </button>
        )
      })}
    </div>
  )
}
