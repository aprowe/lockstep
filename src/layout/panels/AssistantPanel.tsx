// Dockview wrapper around the chat panel — kept thin so the actual UI lives
// in `src/components/AssistantPanel`, alongside the other reusable panels.
import AssistantPanel from '../../components/AssistantPanel'

export default function AssistantPanelDock() {
  return <AssistantPanel />
}
