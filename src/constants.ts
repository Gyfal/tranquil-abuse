export const ITEM_NAMES = {
	TRANQUIL_BOOTS: "item_tranquil_boots",
	RING_OF_REGEN: "item_ring_of_regen",
	BOOTS: "item_boots",
	WIND_LACE: "item_wind_lace"
} as const

export const ITEM_PATTERNS = {
	TRANQUIL_BOOTS: /^item_tranquil_boots/
} as const

export const TRANQUIL_COMPONENTS = [
	ITEM_NAMES.BOOTS,
	ITEM_NAMES.WIND_LACE,
	ITEM_NAMES.RING_OF_REGEN
] as const

// Practical list of harmful debuffs that can tick damage or repeatedly break regen.
// Used as a fallback in addition to dynamic damage detection (RecentDamage/NetworkDamage).
export const DAMAGE_DEBUFF_WHITELIST = [
	"modifier_item_urn_damage",
	"modifier_item_spirit_vessel_damage",
	"modifier_item_radiance_debuff",
	"modifier_item_meteor_hammer_burn",
	"modifier_item_cloak_of_flames_debuff",
	"modifier_item_blood_grenade_debuff",
	"modifier_dragon_scale_burn",
	"modifier_venomancer_venomous_gale",
	"modifier_venomancer_poison_sting",
	"modifier_venomancer_poison_sting_ward",
	"modifier_viper_poison_attack_slow",
	"modifier_viper_viper_strike_slow",
	"modifier_viper_nethertoxin",
	"modifier_huskar_burning_spear_debuff",
	"modifier_axe_battle_hunger",
	"modifier_queenofpain_shadow_strike",
	"modifier_maledict",
	"modifier_jakiro_dual_breath_burn",
	"modifier_jakiro_macropyre_burn",
	"modifier_doom_bringer_doom",
	"modifier_bloodseeker_rupture",
	"modifier_dazzle_poison_touch",
	"modifier_pudge_rot",
	"modifier_phoenix_fire_spirit_burn",
	"modifier_winter_wyvern_arctic_burn_slow",
	"modifier_silencer_curse_of_the_silent",
	"modifier_disruptor_thunder_strike",
	"modifier_treant_natures_grasp_damage",
	"modifier_dragon_knight_fireball_burn",
	"modifier_abyssal_underlord_firestorm_burn"
] as const
export const DAMAGE_DEBUFF_WHITELIST_SET = new Set<string>(
	DAMAGE_DEBUFF_WHITELIST
)

export const enum DISASSEMBLE_CAUSES {
	THREAT = 0,
	ANTI_STICK_CYCLE = 1,
	HOLD_KEY = 2,
	ATTACK_START_MELEE = 3,
	ATTACK_START_RANGED = 4,
	PROJECTILE_CREATED = 5
}

export const REASONS = {
	NONE: "none"
} as const

export type DisassembleCause = DISASSEMBLE_CAUSES

export const ANTI_STICK_CYCLE_STATE = {
	IDLE: "idle",
	AWAIT_DISASSEMBLE_CONFIRM: "await_disassemble_confirm"
} as const

export type AntiStickCycleState =
	(typeof ANTI_STICK_CYCLE_STATE)[keyof typeof ANTI_STICK_CYCLE_STATE]

export const SLEEPER_KEYS = {
	DISASSEMBLE: "tranquil_disassemble",
	DISASSEMBLE_CRITICAL: "tranquil_disassemble_critical",
	UNLOCK_PREFIX: "unlock_"
} as const

export const TIMINGS = {
	CYCLE_INTERVAL: 7.0,
	INITIAL_DISASSEMBLE_WINDOW: 10.0,
	DISASSEMBLE_WINDOW_EPSILON: 0.03,
	OWN_ATTACK_THREAT_BUFFER: 0.08,
	THREAT_COOLDOWN: 0.4,
	RECENT_DAMAGE_THREAT_WINDOW: 0.95,
	DAMAGE_DEBUFF_THREAT_WINDOW: 0.75,
	REASSEMBLE_RETRY_DELAY: 0.1,
	REASSEMBLE_UNLOCK_DELAY_MIN: 0.133,
	REASSEMBLE_UNLOCK_DELAY_MAX: 0.165,
	PROJECTILE_LIFETIME: 2.5,
	DISASSEMBLE_ORDER_COOLDOWN_MS: 120,
	CRITICAL_DISASSEMBLE_ORDER_COOLDOWN_MS: 50,
	COMBINE_ORDER_COOLDOWN_MS: 150
} as const

export const RANGES = {
	ENEMY_THREAT_RADIUS: 450,
	CREEP_THREAT_EXTRA_RANGE: 80
} as const

export const KHANDA_ITEM_NAMES = {
	KHANDA: "item_angels_demise",
	PHYLACTERY: "item_phylactery",
	SOUL_BOOSTER: "item_soul_booster"
} as const

export const KHANDA_COMPONENTS = [
	KHANDA_ITEM_NAMES.PHYLACTERY,
	KHANDA_ITEM_NAMES.SOUL_BOOSTER
] as const

export const enum KHANDA_DISASSEMBLE_CAUSES {
	CAST_INTERCEPT = 0,
	IMPACT_WINDOW = 1
}

export type KhandaDisassembleCause = KHANDA_DISASSEMBLE_CAUSES

export const KHANDA_SLEEPER_KEYS = {
	DISASSEMBLE: "khanda_disassemble",
	DISASSEMBLE_CRITICAL: "khanda_disassemble_critical",
	UNLOCK_PREFIX: "khanda_unlock_"
} as const

export const KHANDA_TIMINGS = {
	DISASSEMBLE_WINDOW_EPSILON: 0.03,
	REASSEMBLE_RETRY_DELAY: 0.1,
	REASSEMBLE_UNLOCK_DELAY_MIN: 0.132,
	REASSEMBLE_UNLOCK_DELAY_MAX: 0.165,
	CAST_WINDOW_EXTRA_BUFFER: 0.08,
	DISASSEMBLE_ORDER_COOLDOWN_MS: 120,
	CRITICAL_DISASSEMBLE_ORDER_COOLDOWN_MS: 50,
	COMBINE_ORDER_COOLDOWN_MS: 150
} as const
