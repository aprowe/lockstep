import type { ListFilterMode } from '../../store/slices/listsSlice'
import './ListFilterTabs.css'

interface Props {
  mode: ListFilterMode
  onChange: (mode: ListFilterMode) => void
  /** Hide the "Clip" option — used by the clips list itself, where
   *  scoping by active clip would be a tautology. */
  hideClipOption?: boolean
  /** Disable the "Clip" option when no active region exists. */
  clipDisabled?: boolean
}

const TAB_LABELS: Record<ListFilterMode, string> = {
  global: 'All',
  viewport: 'View',
  clip: 'Clip',
}

const TAB_TITLES: Record<ListFilterMode, string> = {
  global: 'Show every item',
  viewport: 'Show items inside the current timeline view',
  clip: 'Show items inside the active clip',
}

/** Compact 3-up segmented control rendered above the rows of every list. */
export default function ListFilterTabs({ mode, onChange, hideClipOption, clipDisabled }: Props) {
  const options: ListFilterMode[] = hideClipOption
    ? ['global', 'viewport']
    : ['global', 'viewport', 'clip']
  return (
    <div className="list-filter-tabs" role="tablist">
      {options.map(opt => {
        const disabled = opt === 'clip' && !!clipDisabled
        return (
          <button
            key={opt}
            type="button"
            role="tab"
            aria-selected={mode === opt}
            disabled={disabled}
            className={`list-filter-tab${mode === opt ? ' list-filter-tab--active' : ''}`}
            title={TAB_TITLES[opt]}
            onClick={() => onChange(opt)}
          >
            {TAB_LABELS[opt]}
          </button>
        )
      })}
    </div>
  )
}
