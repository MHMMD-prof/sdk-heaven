import { radius, spacing, typography } from '../../theme';

/** Chat-local Modern Royal tokens. Do not spread these into unrelated screens. */
export const chatColors = Object.freeze({
  canvas: '#090203',
  canvasRaised: '#180609',
  danger: '#F26772',
  divider: 'rgba(224,185,103,0.22)',
  focus: '#F5D993',
  gold: '#E0B967',
  goldBright: '#F5D993',
  goldForeground: '#2B080D',
  online: '#56C596',
  royalRed: '#A61935',
  royalRedBright: '#D43B58',
  royalRedSoft: '#3D0C17',
  scrim: 'rgba(0,0,0,0.62)',
  surface: '#240A10',
  surfaceOutgoing: '#7A1730',
  surfacePressed: '#341018',
  textPrimary: '#FFF8EC',
  textSecondary: '#D5C3B0',
  textTertiary: '#9B8778',
});

export const chatMetrics = Object.freeze({
  avatarInbox: 52,
  avatarThread: 38,
  bubbleMaxWidth: '82%' as const,
  composerInputMaxHeight: 132,
  composerMinHeight: 52,
  contentMaxWidth: 760,
  controlMinHeight: 44,
  gutter: spacing.lg,
  rowMinHeight: 76,
  sheetTopRadius: radius.xl,
  topBarContentHeight: 56,
});

export const chatTypography = Object.freeze({
  body: {
    fontFamily: typography.fontFamily,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.regular,
  },
  metadata: {
    fontFamily: typography.fontFamily,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.medium,
  },
  name: {
    fontFamily: typography.fontFamily,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.bold,
  },
  title: {
    fontFamily: typography.fontFamily,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
  },
});

export const chatMotion = Object.freeze({
  stateTransitionMs: 160,
});
