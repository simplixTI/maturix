export enum WarmupStage {
  NOT_STARTED = 'NOT_STARTED',
  FOUNDATION = 'FOUNDATION',
  EXPANSION = 'EXPANSION',
  SCALING = 'SCALING',
  MATURE = 'MATURE',
}

export interface PhaseConfig {
  stage: WarmupStage;
  dayRange: [number, number];
  description: string;
  dailyLimitMultiplier: number;
  allowedMessageTypes: string[];
  allowGroups: boolean;
  allowStatus: boolean;
  allowCalls: boolean;
  maxNewContactsMultiplier: number;
}

export const WARMUP_PHASES: PhaseConfig[] = [
  {
    stage: WarmupStage.FOUNDATION,
    dayRange: [1, 3],
    description: 'Foundation - build initial trust with low volume',
    dailyLimitMultiplier: 1.0,
    allowedMessageTypes: ['text', 'reaction'],
    allowGroups: false,
    allowStatus: false,
    allowCalls: false,
    maxNewContactsMultiplier: 0.5,
  },
  {
    stage: WarmupStage.EXPANSION,
    dayRange: [4, 5],
    description: 'Expansion - increase volume and add media types',
    dailyLimitMultiplier: 1.0,
    allowedMessageTypes: ['text', 'image', 'reaction', 'sticker'],
    allowGroups: true,
    allowStatus: true,
    allowCalls: false,
    maxNewContactsMultiplier: 0.75,
  },
  {
    stage: WarmupStage.SCALING,
    dayRange: [6, 7],
    description: 'Scaling - near full capacity with all features',
    dailyLimitMultiplier: 1.0,
    allowedMessageTypes: ['text', 'image', 'audio', 'reaction', 'sticker', 'video'],
    allowGroups: true,
    allowStatus: true,
    allowCalls: false,
    maxNewContactsMultiplier: 1.0,
  },
  {
    stage: WarmupStage.MATURE,
    dayRange: [8, Infinity],
    description: 'Mature - full capacity and all features unlocked',
    dailyLimitMultiplier: 1.0,
    allowedMessageTypes: ['text', 'image', 'audio', 'reaction', 'sticker', 'video'],
    allowGroups: true,
    allowStatus: true,
    allowCalls: true,
    maxNewContactsMultiplier: 1.0,
  },
];

export function getPhaseForDay(day: number): PhaseConfig {
  for (const phase of WARMUP_PHASES) {
    if (day >= phase.dayRange[0] && day <= phase.dayRange[1]) {
      return phase;
    }
  }
  return WARMUP_PHASES[WARMUP_PHASES.length - 1];
}

export function getStageForDay(day: number): WarmupStage {
  if (day <= 0) return WarmupStage.NOT_STARTED;
  return getPhaseForDay(day).stage;
}

export function isMessageTypeAllowed(day: number, messageType: string): boolean {
  const phase = getPhaseForDay(day);
  return phase.allowedMessageTypes.includes(messageType);
}
