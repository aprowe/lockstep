import React from 'react'
import type { ListThumbnailMode } from '../../store/slices/listsSlice'
import { IconThumbNone, IconThumbSmall, IconThumbLarge } from '../icons'
import './ListThumbnailToggle.css'

const ORDER: ListThumbnailMode[] = ['none', 'hover', 'always']

const ICON_EL: Record<ListThumbnailMode, React.ReactNode> = {
  none: <IconThumbNone size={14} />,
  hover: <IconThumbSmall size={14} />,
  always: <IconThumbLarge size={14} />,
}

const LABELS: Record<ListThumbnailMode, string> = {
  none: 'Thumbnails: off',
  hover: 'Thumbnails: on hover',
  always: 'Thumbnails: always',
}


interface Props {
  mode: ListThumbnailMode
  onChange: (mode: ListThumbnailMode) => void
}

/** Mode-cycle button used in the top-right of every list panel. Clicking
 *  walks none → hover → always → none. The icon mirrors the current mode
 *  (open / half / filled circle) so the affordance reads at a glance. */
export default function ListThumbnailToggle({ mode, onChange }: Props) {
  const next = () => {
    const i = ORDER.indexOf(mode)
    onChange(ORDER[(i + 1) % ORDER.length])
  }
  return (
    <button
      type="button"
      className="list-thumb-toggle"
      title={LABELS[mode]}
      aria-label={LABELS[mode]}
      onClick={next}
    >
      {ICON_EL[mode]}
    </button>
  )
}
