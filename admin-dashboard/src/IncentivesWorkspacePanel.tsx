import type { User } from 'firebase/auth';
import { lazy, Suspense, useMemo, useState } from 'react';

import { readAdminQueryParameter, setAdminQueryParameter } from './adminDeepLinks';
import { AdminCollectionState } from './AdminUi';
import { AttendanceShadowPanel } from './AttendanceShadowPanel';
import {
  INCENTIVES_TAB_KEYS,
  incentivesTabDescriptions,
  incentivesTabLabels,
  IncentivesTab,
  parseIncentivesTab,
} from './incentivesTabs';
import { PayrollPanel } from './PayrollPanel';

export type { IncentivesTab } from './incentivesTabs';
export { parseIncentivesTab } from './incentivesTabs';

const RocketCampaignPanel = lazy(() => import('./RocketCampaignPanel').then((module) => ({ default: module.RocketCampaignPanel })));
const RoomTargetPanel = lazy(() => import('./RoomTargetPanel').then((module) => ({ default: module.RoomTargetPanel })));
const DailyLoginRewardsPanel = lazy(() => import('./DailyLoginRewardsPanel').then((module) => ({ default: module.DailyLoginRewardsPanel })));
const OpsEventsPanel = lazy(() => import('./OpsEventsPanel').then((module) => ({ default: module.OpsEventsPanel })));
const WeeklyIncentiveIntegrityPanel = lazy(() => import('./WeeklyIncentiveIntegrityPanel').then((module) => ({ default: module.WeeklyIncentiveIntegrityPanel })));

export function IncentivesWorkspacePanel({ permissions, user }: { permissions: string[]; user: User }) {
  const initialTab = useMemo(
    () => parseIncentivesTab(readAdminQueryParameter(window.location.search, 'tab', 40)),
    [],
  );
  const [tab, setTab] = useState<IncentivesTab>(initialTab);
  const [refreshToken, setRefreshToken] = useState(0);

  function switchTab(next: IncentivesTab) {
    setTab(next);
    setAdminQueryParameter('tab', next === 'rocket' ? '' : next);
  }

  return (
    <div className="economy-page incentives-page">
      <header className="economy-hero">
        <div>
          <span className="economy-eyebrow">الحوافز الأسبوعية</span>
          <h1>حوافز الغرف</h1>
          <p>{incentivesTabDescriptions[tab]}</p>
        </div>
        <button
          className="economy-refresh"
          onClick={() => setRefreshToken((current) => current + 1)}
          type="button"
        >
          <span>↻</span> تحديث البيانات
        </button>
      </header>

      <section className="economy-workspace incentives-workspace">
        <div className="economy-tabs" role="tablist" aria-label="أقسام حوافز الغرف">
          {INCENTIVES_TAB_KEYS.map((key) => (
            <button
              aria-selected={tab === key}
              className={tab === key ? 'active' : ''}
              key={key}
              onClick={() => switchTab(key)}
              role="tab"
              type="button"
            >
              <span>{tabIcon(key)}</span>
              {incentivesTabLabels[key]}
            </button>
          ))}
        </div>

        <div className="incentives-tab-panel" key={`${tab}:${refreshToken}`} role="tabpanel">
          <div className="economy-list-head">
            <div>
              <h2>{incentivesTabLabels[tab]}</h2>
              <p>{incentivesTabDescriptions[tab]}</p>
            </div>
          </div>

          <Suspense
            fallback={(
              <AdminCollectionState
                children={null}
                empty={false}
                emptyMessage=""
                loading
                loadingMessage="جارٍ تحميل قسم الحوافز…"
              />
            )}
          >
            {tab === 'rocket' ? <RocketCampaignPanel permissions={permissions} user={user} /> : null}
            {tab === 'room-target' ? <RoomTargetPanel permissions={permissions} user={user} /> : null}
            {tab === 'daily-login' ? <DailyLoginRewardsPanel permissions={permissions} user={user} /> : null}
            {tab === 'ops-events' ? <OpsEventsPanel permissions={permissions} user={user} /> : null}
            {tab === 'payroll' ? (
              <div className="incentives-payroll-stack">
                <PayrollPanel permissions={permissions} user={user} />
                <AttendanceShadowPanel permissions={permissions} user={user} />
              </div>
            ) : null}
            {tab === 'integrity' ? <WeeklyIncentiveIntegrityPanel permissions={permissions} user={user} /> : null}
          </Suspense>
        </div>
      </section>
    </div>
  );
}

function tabIcon(tab: IncentivesTab) {
  switch (tab) {
    case 'rocket':
      return '↑';
    case 'room-target':
      return '◎';
    case 'daily-login':
      return '◌';
    case 'ops-events':
      return '★';
    case 'payroll':
      return '◈';
    case 'integrity':
      return '✓';
    default:
      return '·';
  }
}
