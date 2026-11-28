import { useState, type ReactElement } from 'react';
import { Keyboard, Layers, Languages, Palette, Sparkles } from 'lucide-react';
import type { ServiceDescriptor, UserSettings } from '@langai/contracts';
import { getUiStrings } from '../i18n/translations';
import { MarqueeText } from './MarqueeText';
import { GeneralTab } from './settings/GeneralTab';
import { HotkeysTab } from './settings/HotkeysTab';
import { IntegrationsTab } from './settings/IntegrationsTab';
import { PlayerTab } from './settings/PlayerTab';
import { StyleTab } from './settings/StyleTab';
import { activePillStyle, mutedTextStyle, sectionCardStyle } from './settings/styles';

export interface SettingsPanelProps {
  settings: UserSettings;
  services?: readonly ServiceDescriptor[];
  onUpdateSettings: (partial: Partial<UserSettings>) => Promise<void>;
}

type SettingsSubTab = 'general' | 'style' | 'player' | 'keys' | 'integrations';

export function SettingsPanel({
  settings,
  services = [],
  onUpdateSettings
}: SettingsPanelProps): ReactElement {
  const [activeSubTab, setActiveSubTab] = useState<SettingsSubTab>('general');
  const t = getUiStrings(settings.uiLanguage);

  const subTabs: Array<{
    id: SettingsSubTab;
    label: string;
    icon: typeof Layers;
  }> = [
    { id: 'general', label: t.subTabGeneral, icon: Layers },
    { id: 'style', label: t.subTabStyle, icon: Palette },
    { id: 'player', label: t.subTabPlayer, icon: Languages },
    { id: 'keys', label: t.subTabKeys, icon: Keyboard },
    { id: 'integrations', label: t.subTabIntegrations, icon: Sparkles }
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden text-xs">
      {/* Sticky 5 Mini-Tab Bar */}
      <div
        className="grid shrink-0 grid-cols-5 gap-1 rounded-xl border p-1"
        style={sectionCardStyle}
      >
        {subTabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              title={tab.label}
              onClick={() => setActiveSubTab(tab.id)}
              style={active ? activePillStyle : mutedTextStyle}
              className={`ytai-marquee-btn flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 transition cursor-pointer ${
                active ? 'font-bold shadow-sm' : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.12)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <MarqueeText className="text-[0.625rem] leading-none">{tab.label}</MarqueeText>
            </button>
          );
        })}
      </div>

      {/* Active Mini-Tab Content */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
        {activeSubTab === 'general' && (
          <GeneralTab
            settings={settings}
            services={services}
            onUpdateSettings={onUpdateSettings}
          />
        )}
        {activeSubTab === 'style' && (
          <StyleTab settings={settings} onUpdateSettings={onUpdateSettings} />
        )}
        {activeSubTab === 'player' && (
          <PlayerTab settings={settings} onUpdateSettings={onUpdateSettings} />
        )}
        {activeSubTab === 'keys' && (
          <HotkeysTab settings={settings} onUpdateSettings={onUpdateSettings} />
        )}
        {activeSubTab === 'integrations' && (
          <IntegrationsTab settings={settings} onUpdateSettings={onUpdateSettings} />
        )}
      </div>
    </div>
  );
}
