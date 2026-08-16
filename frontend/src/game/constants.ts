export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 800;

/** Pixels per tile; corridor is 6 tiles wide. */
export const TILE = 72;
export const CORRIDOR_X = (GAME_WIDTH - TILE * 6) / 2;

/** Player screen position: keep most of the view ahead of the player. */
export const CAMERA_FOLLOW_OFFSET_Y = GAME_HEIGHT * 0.22;

export const STEP_TWEEN_MS = 70;
/**
 * Minimum interval between forward steps. Caps sprint speed so traffic is
 * genuinely faster than you; lateral dodges stay uncapped and snappy.
 */
export const FORWARD_STEP_COOLDOWN_MS = 110;

/** A same-lane vehicle honks when it gets this close behind you. */
export const HONK_DISTANCE_TILES = 3.2;
/** Bonus for a vehicle whizzing past one column over while you're on the road. */
export const NEAR_MISS_BONUS = 15;

export const MAX_HEALTH = 100;

/** Commute deadline: seconds granted per metre of route, plus flat slack. */
export const TIME_BUDGET_S_PER_M = 1 / 6;
export const TIME_BUDGET_SLACK_S = 12;
export const MONSOON_EXTRA_TIME_S = 15;
/** Score for every second left on the clock at the finish. */
export const TIME_BONUS_PER_S = 5;

export const DAMAGE = {
  vehicle: 40,
  openDrain: 25,
  brokenSlab: 10,
  splash: 5,
  pedestrian: 5,
  cow: 8,
  dog: 6,
  footpathBike: 15,
  /** Per second while caught by the pressure line. */
  pressurePerSecond: 3.5,
} as const;

/** While swallowed, the crowd shoves you forward this often — the way out. */
export const CROWD_SHOVE_MS = 600;

export const STUN_MS = {
  brokenSlab: 450,
  openDrain: 850,
  pedestrian: 300,
  cow: 600,
  dog: 350,
  footpathBike: 500,
} as const;
export const INVULN_MS = 900;

/** Score per new row reached; footpath rows pay 1.5x. */
export const SCORE_PER_ROW = 10;
export const FOOTPATH_BONUS = 1.5;

/** Pressure line speed in rows per second (ramps up as the run drags on). */
export const PRESSURE_ROWS_PER_S = 0.75;
/** Extra rows/s per elapsed millisecond (~+0.48 rows/s after 2 minutes). */
export const PRESSURE_RAMP = 0.000004;
/** Rows of head start the player gets. */
export const PRESSURE_START_GAP = 6;
/** The crowd never trails the player by more than this many rows. */
export const PRESSURE_RUBBER_BAND_ROWS = 10;

export const VEHICLE_EMOJI: Record<string, string> = {
  car: '🚗',
  rickshaw: '🛺',
  bus: '🚌',
  bike: '🏍️',
};

export const HAZARD_EMOJI: Record<string, string> = {
  hawker_stall: '⛱️',
  parked_scooter: '🛵',
  broken_slab: '🧱',
  open_drain: '🕳️',
  barrier: '⛔',
  dead_end: '🚫',
  construction: '🚧',
  pole: '🚏',
};

/** Cells after the first of a hawker cluster cycle through the wares. */
export const STALL_WARES_EMOJI = ['🍌', '🥭', '🍊', '👕', '🥥', '🌽'];

const POI_EMOJI: Record<string, string> = {
  restaurant: '🍽️',
  cafe: '☕',
  fast_food: '🍔',
  bar: '🍺',
  pub: '🍺',
  bank: '🏦',
  atm: '🏧',
  pharmacy: '💊',
  hospital: '🏥',
  clinic: '🏥',
  doctors: '🏥',
  dentist: '🦷',
  school: '🏫',
  college: '🏫',
  university: '🎓',
  place_of_worship: '🛐',
  cinema: '🎬',
  theatre: '🎭',
  hotel: '🏨',
  guest_house: '🏨',
  marketplace: '🧺',
  police: '👮',
  post_office: '📮',
  fuel: '⛽',
  attraction: '🏛️',
  museum: '🏛️',
  'shop:clothes': '👗',
  'shop:jewelry': '💍',
  'shop:bakery': '🥐',
  'shop:convenience': '🏪',
  'shop:supermarket': '🛒',
  'shop:hairdresser': '💈',
  'shop:mobile_phone': '📱',
  'shop:shoes': '👟',
  'shop:electronics': '🔌',
  'shop:books': '📚',
  'shop:sports': '🏏',
};

export function poiEmoji(category: string): string {
  if (POI_EMOJI[category]) return POI_EMOJI[category];
  if (category.startsWith('shop:')) return '🛍️';
  if (category.startsWith('historic:')) return '🏛️';
  return '📍';
}

export const COLORS = {
  footpath: 0xb8a88a,
  footpathDark: 0xaa9a7c,
  kerb: 0x757068,
  railingFill: 0x46464c,
  railingPost: 0x9aa4b0,
  road: 0x3a3a40,
  roadDark: 0x35353b,
  laneMark: 0x8a8a92,
  blocked: 0x2c2c30,
  flooded: 0x33638f,
  puddle: 0x4a7fb5,
  pressureDry: 0xc0392b,
  pressureWet: 0x2f6ea0,
} as const;
