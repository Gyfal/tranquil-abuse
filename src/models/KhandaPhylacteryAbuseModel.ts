import {
	Ability,
	DOTA_ABILITY_BEHAVIOR,
	dotaunitorder_t,
	EventsSDK,
	ExecuteOrder,
	GameState,
	GameSleeper,
	Hero,
	Item,
	TrackingProjectile,
	Unit
} from "github.com/octarine-public/wrapper/index"

import {
	KHANDA_COMPONENTS,
	KHANDA_DISASSEMBLE_CAUSES,
	type KhandaDisassembleCause,
	KHANDA_ITEM_NAMES,
	KHANDA_SLEEPER_KEYS,
	KHANDA_TIMINGS
} from "../constants"
import { KhandaMenuModel } from "../menu/KhandaMenuModel"
import { BaseAbuseModel } from "./BaseAbuseModel"

export class KhandaPhylacteryAbuseModel extends BaseAbuseModel {
	private readonly actionSleeper = new GameSleeper()
	private readonly scheduledProjectileImpactAt: number[] = []

	private reassembleRetryAt = 0
	private nextReassembleUnlockAt = 0
	private pendingCastActive = false
	private pendingCastReleaseAt = 0
	private pendingCastIntentTimeoutAt = 0
	private pendingCastAbilityIndex = -1
	private pendingCastTargetIndex = -1
	private pendingCastChannelActive = false
	private pendingCastPhaseStarted = false
	private pendingCastKhandaWasOnCD = false
	private pendingCastIsChannelled = false
	private spellCastWindowUntil = 0
	private phylacteryCooldownUntil = 0
	private lastObservedPhylacteryCooldown = 0
	private hasSeenKhanda = false

	constructor(private readonly menu: KhandaMenuModel) {
		super()
		EventsSDK.on("PrepareUnitOrders", this.onPrepareUnitOrders.bind(this))
		EventsSDK.on("AbilityPhaseChanged", this.onAbilityPhaseChanged.bind(this))
		EventsSDK.on(
			"AbilityChannelingChanged",
			this.onAbilityChannelingChanged.bind(this)
		)
		EventsSDK.on(
			"TrackingProjectileCreated",
			this.onTrackingProjectileCreated.bind(this)
		)
	}

	protected get State() {
		return this.menu.State.value
	}

	public GameEnded() {
		this.resetRuntimeState()
	}

	public PostDataUpdate(dt: number) {
		if (dt === 0) {
			return
		}

		if (!this.canRun()) {
			this.resetRuntimeState()
			return
		}

		const hero = this.hero!
		const now = this.now
		this.cleanupProjectileImpactSchedule(now)

		const khanda = this.getKhanda(hero)
		if (khanda !== undefined) {
			this.hasSeenKhanda = true
		}

		if (khanda === undefined) {
			const isOwnCastWindowActive =
				this.getOwnCastWindowRemaining(now) >
				KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON
			const shouldReturnKhandaByCooldown = this.isPhylacteryCooldownActive()
			const canReturnKhanda =
				shouldReturnKhandaByCooldown ||
				(
					!isOwnCastWindowActive &&
					!this.shouldDelayReassemble(now)
				)

			if (
				this.isKhandaDisassembled(hero) &&
				canReturnKhanda &&
				now >= this.reassembleRetryAt
			) {
				this.tryReassembleKhandaSequentially(hero, now)
			} else if (!canReturnKhanda) {
				this.nextReassembleUnlockAt = 0
			}
			return
		}
		this.nextReassembleUnlockAt = 0

		const ownCastWindowRemain = this.getOwnCastWindowRemaining(now)
		const projectileFlightRemain = this.getProjectileFlightRemaining(now)
		const impactWindowRemain = this.getProjectileImpactWindowRemaining(now)
		const shouldKeepDisassembled =
			this.pendingCastChannelActive ||
			ownCastWindowRemain > KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON ||
			projectileFlightRemain > KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON ||
			impactWindowRemain > KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON

		if (this.pendingCastActive && !shouldKeepDisassembled) {
			this.clearPendingCast()
		}

		if (this.isPhylacteryCooldownActive()) {
			return
		}

		if (shouldKeepDisassembled) {
			const shouldWaitCastReleaseForKhandaPriority =
				this.pendingCastActive &&
				!this.pendingCastKhandaWasOnCD &&
				!this.pendingCastChannelActive &&
				projectileFlightRemain <= KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON &&
				impactWindowRemain <= KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON &&
				(
					this.pendingCastReleaseAt <= 0 ||
					now < this.pendingCastReleaseAt
				)

			if (!shouldWaitCastReleaseForKhandaPriority) {
				// For channelled spells: only disassemble when the projectile
				// is about to hit (impact window), not during channel/cast.
				const shouldWaitForImpact =
					this.pendingCastKhandaWasOnCD &&
					this.pendingCastIsChannelled &&
					impactWindowRemain <= KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON

				if (!shouldWaitForImpact) {
					this.disassembleKhanda(
						khanda,
						KHANDA_DISASSEMBLE_CAUSES.IMPACT_WINDOW,
						false
					)
				}
			}
			return
		}

	}

	private onPrepareUnitOrders(order: ExecuteOrder) {
		if (!this.canRun() || !order.IsPlayerInput) {
			return
		}

		const hero = this.hero
		if (hero === undefined || !hero.IsValid || !hero.IsAlive) {
			return
		}

		if (!order.Issuers.some(issuer => issuer.Index === hero.Index)) {
			return
		}

		if (this.isPlayerOrderInterruptingPendingCast(order)) {
			this.clearPendingCast()
		}

		if (order.OrderType !== dotaunitorder_t.DOTA_UNIT_ORDER_CAST_TARGET) {
			return
		}

		const ability = order.Ability_
		if (
			!(ability instanceof Ability) ||
			ability.IsItem ||
			ability.Owner?.Index !== hero.Index
		) {
			return
		}

		const khanda = this.getKhanda(hero)
		if (khanda === undefined) {
			return
		}

		const target = order.Target
		if (target instanceof Unit && target.Team === hero.Team) {
			return
		}

		this.hasSeenKhanda = true
		const now = this.now

		if (order.Queue) {
			return
		}

		// If Khanda is on CD and Phylactery is ready, disassemble Khanda
		// BEFORE the spell order goes through — but only for non-channelled spells.
		// Channelled spells should wait for the projectile to fly before disassembly.
		const khandaOnCD = khanda.Cooldown > KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON
		const isChannelled = ability.HasBehavior(
			DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_CHANNELLED
		)
		if (khandaOnCD && !isChannelled && !this.isPhylacteryCooldownActive()) {
			hero.DisassembleItem(khanda, false)
		}

		const castWindowDuration = this.getCastWindowDuration(ability, order)
		this.markPendingCastIntent(
			ability,
			now,
			castWindowDuration,
			target instanceof Unit ? target.Index : -1
		)
	}

	private onTrackingProjectileCreated(projectile: TrackingProjectile) {
		const hero = this.hero
		if (hero === undefined || !hero.IsValid) {
			return
		}

		if (this.pendingCastAbilityIndex === -1) {
			return
		}

		if (projectile.Source?.Index !== hero.Index) {
			return
		}

		if (projectile.IsAttack) {
			return
		}

		const projectileAbilityIndex = projectile.AbilityIndex ?? -1
		const abilityMatches =
			projectileAbilityIndex === this.pendingCastAbilityIndex ||
			projectileAbilityIndex === -1
		if (!abilityMatches) {
			return
		}

		const target = projectile.Target
		if (
			this.pendingCastTargetIndex !== -1 &&
			(target === undefined || target.Index !== this.pendingCastTargetIndex)
		) {
			return
		}

		const impactAt = this.getProjectileImpactAt(projectile)
		this.scheduledProjectileImpactAt.push(impactAt)
		this.cleanupProjectileImpactSchedule(this.now)
	}

	private onAbilityPhaseChanged(ability: Ability) {
		if (!this.canRun()) {
			return
		}

		const hero = this.hero
		if (
			hero === undefined ||
			!hero.IsValid ||
			ability.Owner?.Index !== hero.Index ||
			ability.IsItem
		) {
			return
		}

		const now = this.now
		let isTrackedPendingAbility = this.isTrackedPendingAbility(ability)
		if (ability.IsInAbilityPhase && !isTrackedPendingAbility) {
			if (
				this.getKhanda(hero) === undefined ||
				!this.isPhylacteryTargetingAbility(ability)
			) {
				return
			}

			this.hasSeenKhanda = true
			this.markPendingCastIntent(
				ability,
				now,
				this.getFallbackCastWindowDuration(ability),
				-1
			)
			isTrackedPendingAbility = true
		}

		if (!this.pendingCastActive || !isTrackedPendingAbility) {
			return
		}

		if (ability.IsInAbilityPhase) {
			this.pendingCastPhaseStarted = true
			this.pendingCastReleaseAt = Math.max(
				this.pendingCastReleaseAt,
				now + Math.max(ability.CastPoint + 0.12, 0.12)
			)
			this.spellCastWindowUntil = Math.max(
				this.spellCastWindowUntil,
				this.pendingCastReleaseAt
			)
			return
		}

		if (!this.pendingCastPhaseStarted && this.pendingCastReleaseAt <= 0) {
			this.pendingCastReleaseAt = now + 0.08
		}
	}

	private onAbilityChannelingChanged(ability: Ability) {
		if (!this.canRun()) {
			return
		}

		if (!this.pendingCastActive || !this.isTrackedPendingAbility(ability)) {
			return
		}

		const owner = ability.Owner
		if (owner === undefined) {
			return
		}

		const now = this.now
		const timingBuffer = this.getProjectileTimingBuffer()
		if (owner.IsChanneling) {
			this.pendingCastChannelActive = true
			this.pendingCastPhaseStarted = true

			// Keep a conservative fallback timer while channel is active.
			const channelRemain = Math.max(ability.ChannelEndTime, ability.MaxChannelTime, 0)
			this.pendingCastReleaseAt = Math.max(
				this.pendingCastReleaseAt,
				now + Math.max(channelRemain + timingBuffer, 0.15)
			)
			this.spellCastWindowUntil = Math.max(
				this.spellCastWindowUntil,
				this.pendingCastReleaseAt
			)
			return
		}

		// Channel finished (release/cancel). Keep short delay for projectile spawn sync.
		this.pendingCastChannelActive = false
		this.pendingCastReleaseAt = now + timingBuffer
		this.spellCastWindowUntil = this.pendingCastReleaseAt
	}

	private resetRuntimeState() {
		this.reassembleRetryAt = 0
		this.nextReassembleUnlockAt = 0
		this.pendingCastActive = false
		this.pendingCastReleaseAt = 0
		this.pendingCastIntentTimeoutAt = 0
		this.pendingCastAbilityIndex = -1
		this.pendingCastTargetIndex = -1
		this.pendingCastChannelActive = false
		this.pendingCastPhaseStarted = false
		this.pendingCastKhandaWasOnCD = false
		this.pendingCastIsChannelled = false
		this.spellCastWindowUntil = 0
		this.phylacteryCooldownUntil = 0
		this.lastObservedPhylacteryCooldown = 0
		this.hasSeenKhanda = false
		this.scheduledProjectileImpactAt.length = 0
		this.actionSleeper.FullReset()
	}

	private getKhanda(hero: Hero): Nullable<Item> {
		return hero.GetItemByName(KHANDA_ITEM_NAMES.KHANDA, true)
	}

	private getPhylactery(hero: Hero): Nullable<Item> {
		return hero.GetItemByName(KHANDA_ITEM_NAMES.PHYLACTERY, true)
	}

	private isKhandaDisassembled(hero: Hero): boolean {
		if (this.getKhanda(hero) !== undefined || !this.hasSeenKhanda) {
			return false
		}

		for (const componentName of KHANDA_COMPONENTS) {
			if (hero.GetItemByName(componentName, true) === undefined) {
				return false
			}
		}

		return true
	}

	private disassembleKhanda(
		khanda: Item,
		cause: KhandaDisassembleCause,
		queue: boolean
	): boolean {
		const hero = this.hero
		if (hero === undefined) {
			return false
		}

		if (this.getKhanda(hero) === undefined) {
			return false
		}

		// Only disassemble if Khanda was already on CD when the current cast started.
		// This prevents disassembly on the same spell that just proced Khanda normally.
		if (!this.pendingCastKhandaWasOnCD) {
			return false
		}

		if (this.isPhylacteryCooldownActive()) {
			return false
		}

		const isCriticalCause = cause === KHANDA_DISASSEMBLE_CAUSES.CAST_INTERCEPT
			|| cause === KHANDA_DISASSEMBLE_CAUSES.IMPACT_WINDOW
		const disassembleSleeperKey = isCriticalCause
			? KHANDA_SLEEPER_KEYS.DISASSEMBLE_CRITICAL
			: KHANDA_SLEEPER_KEYS.DISASSEMBLE
		if (this.actionSleeper.Sleeping(disassembleSleeperKey)) {
			return false
		}

		hero.DisassembleItem(khanda, queue)
		this.actionSleeper.Sleep(
			isCriticalCause
				? KHANDA_TIMINGS.CRITICAL_DISASSEMBLE_ORDER_COOLDOWN_MS
				: KHANDA_TIMINGS.DISASSEMBLE_ORDER_COOLDOWN_MS,
			disassembleSleeperKey
		)
		return true
	}

	private tryReassembleKhandaSequentially(hero: Hero, now: number) {
		if (now < this.reassembleRetryAt || now < this.nextReassembleUnlockAt) {
			return
		}

		const nextLockedComponentName = this.getNextLockedKhandaComponentName(hero)
		if (nextLockedComponentName === undefined) {
			this.nextReassembleUnlockAt = 0
			this.reassembleRetryAt = now + KHANDA_TIMINGS.REASSEMBLE_RETRY_DELAY
			return
		}

		if (this.unlockCombine(nextLockedComponentName)) {
			this.nextReassembleUnlockAt = now + this.getReassembleUnlockDelay()
		}
	}

	private getNextLockedKhandaComponentName(hero: Hero): Nullable<string> {
		for (const componentName of KHANDA_COMPONENTS) {
			const component = hero.GetItemByName(componentName, true)
			if (component !== undefined && component.IsCombineLocked) {
				return componentName
			}
		}

		return undefined
	}

	private getReassembleUnlockDelay(): number {
		const pingSeconds = GameState.Ping / 1000
		const inputLag = GameState.InputLag

		const randomBaseDelay =
			KHANDA_TIMINGS.REASSEMBLE_UNLOCK_DELAY_MIN +
			Math.random() *
			(KHANDA_TIMINGS.REASSEMBLE_UNLOCK_DELAY_MAX - KHANDA_TIMINGS.REASSEMBLE_UNLOCK_DELAY_MIN)

		return Math.max(randomBaseDelay, pingSeconds + inputLag, 0.1)
	}

	private unlockCombine(itemName: string): boolean {
		const hero = this.hero
		const component = hero?.GetItemByName(itemName, true)
		if (hero === undefined || component === undefined || !component.IsCombineLocked) {
			return false
		}

		const key = `${KHANDA_SLEEPER_KEYS.UNLOCK_PREFIX}${itemName}`
		if (this.actionSleeper.Sleeping(key)) {
			return false
		}

		hero.ItemSetCombineLock(component, false, true)
		this.actionSleeper.Sleep(KHANDA_TIMINGS.COMBINE_ORDER_COOLDOWN_MS, key)
		return true
	}

	private getCastWindowDuration(ability: Ability, order: ExecuteOrder): number {
		const baseDuration = this.getFallbackCastWindowDuration(ability)
		const target = order.Target
		if (!(target instanceof Unit)) {
			return baseDuration
		}

		const hitTime = ability.GetHitTime(target)
		if (hitTime <= 0) {
			return baseDuration
		}

		return Math.max(
			hitTime + KHANDA_TIMINGS.CAST_WINDOW_EXTRA_BUFFER,
			baseDuration
		)
	}

	private getFallbackCastWindowDuration(ability: Ability): number {
		return Math.max(
			ability.CastDelay + KHANDA_TIMINGS.CAST_WINDOW_EXTRA_BUFFER,
			0.12
		)
	}

	private markPendingCastIntent(
		ability: Ability,
		now: number,
		castWindowDuration: number,
		targetIndex: number
	) {
		const releaseFallbackDelay = Math.max(
			ability.CastPoint + this.getProjectileTimingBuffer(),
			0.08
		)

		const hero = this.hero
		const khandaCD = hero !== undefined ? (this.getKhanda(hero)?.Cooldown ?? 0) : 0
		const isChannelled = ability.HasBehavior(
			DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_CHANNELLED
		)

		this.pendingCastActive = true
		this.pendingCastPhaseStarted = false
		this.pendingCastKhandaWasOnCD = khandaCD > KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON
		this.pendingCastIsChannelled = isChannelled
		this.pendingCastReleaseAt = now + releaseFallbackDelay
		this.pendingCastIntentTimeoutAt = now + 8
		this.pendingCastAbilityIndex = ability.Index
		this.pendingCastTargetIndex = targetIndex
		this.pendingCastChannelActive = false
		this.spellCastWindowUntil = Math.max(
			this.spellCastWindowUntil,
			now + castWindowDuration
		)
	}

	private clearPendingCast() {
		if (!this.pendingCastActive) {
			return
		}

		this.pendingCastActive = false
		this.pendingCastReleaseAt = 0
		this.pendingCastIntentTimeoutAt = 0
		this.pendingCastAbilityIndex = -1
		this.pendingCastTargetIndex = -1
		this.pendingCastChannelActive = false
		this.pendingCastPhaseStarted = false
		this.pendingCastKhandaWasOnCD = false
		this.pendingCastIsChannelled = false
	}

	private shouldDelayReassemble(now: number): boolean {
		if (now < this.spellCastWindowUntil) {
			return true
		}

		const hero = this.hero
		if (hero !== undefined && hero.IsChanneling) {
			return true
		}

		if (this.pendingCastChannelActive) {
			return true
		}

		const projectileFlightRemain = this.getProjectileFlightRemaining(now)
		if (
			projectileFlightRemain >
			KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON
		) {
			return true
		}

		const trackedProjectileRemain = this.getProjectileImpactWindowRemaining(now)
		if (
			trackedProjectileRemain >
			KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON
		) {
			return true
		}

		if (!this.pendingCastActive) {
			return false
		}

		if (this.pendingCastReleaseAt <= 0) {
			if (now < this.pendingCastIntentTimeoutAt) {
				return true
			}

			this.clearPendingCast()
			return false
		}

		if (now < this.pendingCastReleaseAt) {
			return true
		}

		this.clearPendingCast()
		return false
	}

	private getOwnCastWindowRemaining(now: number = this.now): number {
		return Math.max(this.spellCastWindowUntil - now, 0)
	}

	private getProjectileFlightRemaining(now: number = this.now): number {
		this.cleanupProjectileImpactSchedule(now)

		let remaining = 0
		for (const impactAt of this.scheduledProjectileImpactAt) {
			if (impactAt <= now) {
				continue
			}
			remaining = Math.max(remaining, impactAt - now)
		}

		return remaining
	}

	private getProjectileImpactWindowRemaining(now: number = this.now): number {
		this.cleanupProjectileImpactSchedule(now)

		const preImpact = this.getProjectilePreImpactLead()
		const postImpact = this.getProjectilePostImpactLead()
		let remaining = 0
		for (const impactAt of this.scheduledProjectileImpactAt) {
			const startAt = impactAt - preImpact
			const endAt = impactAt + postImpact
			if (now < startAt || now >= endAt) {
				continue
			}

			remaining = Math.max(remaining, endAt - now)
		}

		return remaining
	}

	private isPlayerOrderInterruptingPendingCast(order: ExecuteOrder): boolean {
		if (!this.pendingCastActive || order.Queue) {
			return false
		}

		const ability = order.Ability_
		return !(ability instanceof Ability) || ability.Index !== this.pendingCastAbilityIndex
	}

	private isTrackedPendingAbility(ability: Ability): boolean {
		const hero = this.hero
		return (
			this.pendingCastActive &&
			this.pendingCastAbilityIndex !== -1 &&
			ability.Index === this.pendingCastAbilityIndex &&
			ability.Owner?.Index === hero?.Index
		)
	}

	private isPhylacteryTargetingAbility(ability: Ability): boolean {
		return ability.HasBehavior(
			DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET
		)
	}

	private getProjectileImpactAt(projectile: TrackingProjectile): number {
		const now = this.now
		if (projectile.ExpireTime > now) {
			return projectile.ExpireTime
		}

		if (
			projectile.Speed > 0 &&
			projectile.Source instanceof Unit &&
			projectile.Target instanceof Unit
		) {
			return now + projectile.Source.Distance2D(projectile.Target) / projectile.Speed
		}

		return now + 0.5
	}

	private getProjectileTimingBuffer(): number {
		const tick = GameState.TickInterval
		const inputLag = GameState.InputLag
		const incomingIOLag = this.getIncomingIOLag()
		const jitter = Math.max(GameState.LatestTickDelta, tick)

		return Math.max(
			inputLag + incomingIOLag + tick,
			inputLag + tick * 2,
			incomingIOLag + tick * 2,
			jitter + tick,
			0.12
		)
	}

	private getIncomingIOLag(): number {
		return GameState.GetIOLag(GameState.GetLatency())
	}

	private getProjectilePreImpactLead(): number {
		// Need enough lead to pass order latency and disassemble command cooldown.
		return (
			this.getProjectileTimingBuffer() +
			KHANDA_TIMINGS.CRITICAL_DISASSEMBLE_ORDER_COOLDOWN_MS / 1000 +
			GameState.TickInterval
		)
	}

	private getProjectilePostImpactLead(): number {
		return Math.max(this.getProjectileTimingBuffer() * 0.5, GameState.TickInterval * 2)
	}

	private cleanupProjectileImpactSchedule(now: number) {
		const oldestAllowed = now - this.getProjectilePostImpactLead()
		let write = 0
		for (let i = 0; i < this.scheduledProjectileImpactAt.length; i++) {
			const impactAt = this.scheduledProjectileImpactAt[i]
			if (impactAt >= oldestAllowed) {
				this.scheduledProjectileImpactAt[write++] = impactAt
			}
		}

		this.scheduledProjectileImpactAt.length = write
	}

	private isPhylacteryCooldownActive(): boolean {
		return this.getPhylacteryCooldownRemaining() > KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON
	}

	private getPhylacteryCooldownRemaining(): number {
		const hero = this.hero
		if (hero === undefined || !hero.IsValid) {
			return 0
		}

		const now = this.now
		const phylacteryItemCooldown = this.getPhylactery(hero)?.Cooldown ?? 0

		const syntheticCooldown = Math.max(this.phylacteryCooldownUntil - now, 0)

		if (phylacteryItemCooldown > KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON) {
			const observedStartedNow =
				this.lastObservedPhylacteryCooldown <=
				KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON
			const syntheticActive =
				syntheticCooldown > KHANDA_TIMINGS.DISASSEMBLE_WINDOW_EPSILON

			// Arm once on 0 -> >0 edge; do not extend while active.
			if (observedStartedNow && !syntheticActive) {
				this.phylacteryCooldownUntil = now + phylacteryItemCooldown
			}
		}

		this.lastObservedPhylacteryCooldown = phylacteryItemCooldown
		return Math.max(this.phylacteryCooldownUntil - now, 0)
	}
}
