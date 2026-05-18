import { assertLayoutMatches } from '../helpers/runLayout'
import { renderToolbar } from '../harnesses/toolbar'

const { container } = renderToolbar()
assertLayoutMatches('main-toolbar', container)
