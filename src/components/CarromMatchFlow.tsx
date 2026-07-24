import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { MatchStatus, MatchTable } from '../types/carromMatch';
import { CARROM_MATCH_TABLES } from '../utils/localCarromMatchController';

type TableSelectionProps = {
  compact: boolean;
  onBack: () => void;
  onSelect: (table: MatchTable) => void;
};

export function TableSelection({ compact, onBack, onSelect }: TableSelectionProps) {
  return (
    <View style={[styles.matchFlowPanel, compact && styles.matchFlowPanelCompact]}>
      <View style={styles.matchFlowHeader}>
        <Text style={styles.matchFlowKicker}>مطابقة تنافسية</Text>
        <Text style={styles.matchFlowTitle}>اختر الطاولة</Text>
        <Text style={styles.matchFlowSubtitle}>
          اختر مستوى الرموز، ثم ادخل مرحلة الجاهزية قبل بداية الجولة.
        </Text>
      </View>

      <View style={styles.tableList}>
        {CARROM_MATCH_TABLES.map((table) => (
          <Pressable
            key={table.id}
            onPress={() => onSelect(table)}
            style={[styles.tableCard, { borderColor: table.accentColor }]}
          >
            <View style={styles.tableCardTop}>
              <View style={[styles.tableAccent, { backgroundColor: table.accentColor }]} />
              <View style={styles.tableCopy}>
                <Text style={styles.tableTitle}>{table.title}</Text>
                <Text style={styles.tableMeta}>{table.speedLabel}</Text>
              </View>
            </View>
            <View style={styles.tableStats}>
              <Text style={styles.tableStat}>{table.stakeLabel}</Text>
              <Text style={styles.tablePrize}>{table.prizeLabel}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      <Pressable onPress={onBack} style={styles.matchFlowGhostButton}>
        <Text style={styles.matchFlowGhostText}>رجوع</Text>
      </Pressable>
    </View>
  );
}

type ReadyCountdownPanelProps = {
  countdown: number;
  opponentReady: boolean;
  onLeave: () => void;
  onReady: () => void;
  phase: MatchStatus;
  playerReady: boolean;
  table: MatchTable;
};

export function ReadyCountdownPanel({
  countdown,
  opponentReady,
  onLeave,
  onReady,
  phase,
  playerReady,
  table,
}: ReadyCountdownPanelProps) {
  const isCountingDown = phase === 'countdown';

  return (
    <View style={styles.matchFlowPanel}>
      <View style={styles.readyTableBadge}>
        <View style={[styles.tableAccent, { backgroundColor: table.accentColor }]} />
        <View style={styles.tableCopy}>
          <Text style={styles.tableTitle}>{table.title}</Text>
          <Text style={styles.tableMeta}>
            {table.stakeLabel} · {table.prizeLabel}
          </Text>
        </View>
      </View>

      <View style={styles.readyStateGrid}>
        <ReadySeat label="أنت" ready={playerReady} />
        <ReadySeat label="الخصم" ready={opponentReady} />
      </View>

      {isCountingDown ? (
        <View style={styles.countdownStage}>
          <Text style={styles.countdownLabel}>تبدأ الجولة خلال</Text>
          <Text style={styles.countdownValue}>{countdown || 'ابدأ'}</Text>
        </View>
      ) : (
        <View style={styles.readyCopy}>
          <Text style={styles.readyTitle}>جاهز للدخول؟</Text>
          <Text style={styles.readySubtitle}>
            عند الضغط على جاهز يتم قفل الطاولة وتشغيل العد التنازلي.
          </Text>
        </View>
      )}

      <View style={styles.readyActions}>
        <Pressable
          disabled={isCountingDown}
          onPress={onReady}
          style={[
            styles.readyButton,
            styles.readyButtonPrimary,
            isCountingDown && styles.readyButtonDisabled,
          ]}
        >
          <Text style={styles.readyButtonPrimaryText}>
            {isCountingDown ? 'تم القفل' : 'جاهز'}
          </Text>
        </Pressable>
        <Pressable onPress={onLeave} style={styles.readyButton}>
          <Text style={styles.readyButtonText}>تغيير الطاولة</Text>
        </Pressable>
      </View>
    </View>
  );
}

type ReadySeatProps = {
  label: string;
  ready: boolean;
};

function ReadySeat({ label, ready }: ReadySeatProps) {
  return (
    <View style={[styles.readySeat, ready && styles.readySeatActive]}>
      <View style={[styles.readyDot, ready && styles.readyDotActive]} />
      <Text style={styles.readySeatLabel}>{label}</Text>
      <Text style={styles.readySeatStatus}>{ready ? 'جاهز' : 'انتظار'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  matchFlowPanel: {
    backgroundColor: 'rgba(21,7,7,0.94)',
    borderColor: 'rgba(217,164,65,0.62)',
    borderRadius: radius.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  matchFlowPanelCompact: {
    gap: spacing.sm,
    padding: spacing.sm,
  },
  matchFlowHeader: {
    alignItems: 'center',
  },
  matchFlowKicker: {
    color: '#D9A441',
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  matchFlowTitle: {
    color: '#F4E7CD',
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    marginTop: spacing.xs,
    writingDirection: 'rtl',
  },
  matchFlowSubtitle: {
    color: '#B9A58C',
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    lineHeight: 18,
    marginTop: spacing.xs,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  tableList: {
    gap: spacing.sm,
  },
  tableCard: {
    backgroundColor: 'rgba(6,4,4,0.84)',
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  tableCardTop: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
  },
  tableAccent: {
    borderRadius: radius.full,
    height: 34,
    width: 6,
  },
  tableCopy: {
    flex: 1,
    minWidth: 0,
  },
  tableTitle: {
    color: '#F4E7CD',
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  tableMeta: {
    color: '#A9957D',
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  tableStats: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
  },
  tableStat: {
    color: '#F4D27A',
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  tablePrize: {
    color: '#A9957D',
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  matchFlowGhostButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(58,10,13,0.78)',
    borderColor: 'rgba(217,164,65,0.38)',
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 110,
    paddingHorizontal: spacing.lg,
  },
  matchFlowGhostText: {
    color: '#F4E7CD',
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  readyTableBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(5,3,3,0.78)',
    borderColor: 'rgba(217,164,65,0.28)',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    padding: spacing.md,
  },
  readyStateGrid: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
  },
  readySeat: {
    alignItems: 'center',
    backgroundColor: 'rgba(61,10,13,0.42)',
    borderColor: 'rgba(217,164,65,0.24)',
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 92,
    padding: spacing.sm,
  },
  readySeatActive: {
    backgroundColor: 'rgba(217,164,65,0.12)',
    borderColor: 'rgba(244,210,122,0.58)',
  },
  readyDot: {
    backgroundColor: colors.textSubtle,
    borderRadius: radius.full,
    height: 12,
    width: 12,
  },
  readyDotActive: {
    backgroundColor: '#F4D27A',
  },
  readySeatLabel: {
    color: '#F4E7CD',
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  readySeatStatus: {
    color: '#A9957D',
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  readyCopy: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 86,
  },
  readyTitle: {
    color: '#F4E7CD',
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  readySubtitle: {
    color: '#B9A58C',
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    lineHeight: 18,
    marginTop: spacing.xs,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  countdownStage: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 128,
  },
  countdownLabel: {
    color: '#B9A58C',
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  countdownValue: {
    color: '#F4D27A',
    fontSize: 58,
    fontWeight: typography.weights.black,
    lineHeight: 66,
    marginTop: spacing.xs,
    writingDirection: 'rtl',
  },
  readyActions: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
  },
  readyButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(58,10,13,0.82)',
    borderColor: 'rgba(217,164,65,0.34)',
    borderRadius: radius.full,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  readyButtonPrimary: {
    backgroundColor: '#D9A441',
    borderColor: '#F4D27A',
  },
  readyButtonDisabled: {
    opacity: 0.58,
  },
  readyButtonText: {
    color: '#F4E7CD',
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  readyButtonPrimaryText: {
    color: '#140804',
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
});
