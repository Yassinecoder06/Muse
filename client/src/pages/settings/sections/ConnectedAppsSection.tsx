import { ConnectedApps } from '../../../components/ConnectedApps'
import { SettingsSection } from '../ui'

export function ConnectedAppsSection({ onToast }: { onToast: (message: string) => void }) {
  return (
    <SettingsSection
      title="Connected apps"
      description="Let Claude, ChatGPT, Cursor and other AI apps use Muse through muse-mcp."
    >
      <ConnectedApps onToast={onToast}/>
    </SettingsSection>
  )
}
