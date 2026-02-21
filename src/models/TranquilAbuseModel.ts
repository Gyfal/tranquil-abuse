import {
	Entity,
	EntityManager,
	EventsSDK,
	GameSleeper,
	GameState,
	Hero,
	Item,
	TrackingProjectile,
	Unit
} from "github.com/octarine-public/wrapper/index"

import {
	ANTI_STICK_CYCLE_STATE,
	DAMAGE_DEBUFF_WHITELIST_SET,
	DISASSEMBLE_CAUSES,
	type AntiStickCycleState,
	type DisassembleCause,
	ITEM_NAMES,
	ITEM_PATTERNS,
	RANGES,
	SLEEPER_KEYS,
	TIMINGS,
	TRANQUIL_COMPONENTS
} from "../constants"
import { TranquilMenuModel } from "../menu/TranquilMenuModel"
import { BaseAbuseModel } from "./BaseAbuseModel"

export class TranquilAbuseModel extends BaseAbuseModel {
	private readonly activeProjectiles = new Map<number, number>()
	private readonly ownAttackProjectiles = new Set<number>()
	private readonly actionSleeper = new GameSleeper()
	private readonly meleeHeroThreatCandidates = new Set<Hero>()
	private readonly meleeCreepThreatCandidates = new Set<Unit>()

	private lastCycleTime = 0
	private antiStickCycleState: AntiStickCycleState = ANTI_STICK_CYCLE_STATE.IDLE
	private antiStickCycleRetryAt = 0
	private reassembleRetryAt = 0
	private nextReassembleUnlockAt = 0
	private lastThreatTime = 0
	private ownAttackThreatUntil = 0
	private damageThreatUntil = 0

	private lastRecentDamageSample = 0
	private hadDamageDebuff = false
	private hasSeenTranquils = false
	private threatCandidatesBootstrapped = false

	constructor(private readonly menu: TranquilMenuModel) {
		super()
		EventsSDK.on("AttackStarted", this.onAttackStarted.bind(this))
		EventsSDK.on("EntityCreated", this.onEntityCreated.bind(this))
		EventsSDK.on("EntityDestroyed", this.onEntityDestroyed.bind(this))
		EventsSDK.on("GameStarted", this.onGameStarted.bind(this))
		EventsSDK.on(
			"TrackingProjectileCreated",
			this.onTrackingProjectileCreated.bind(this)
		)
		EventsSDK.on(
			"TrackingProjectileUpdated",
			this.onTrackingProjectileUpdated.bind(this)
		)
		EventsSDK.on(
			"TrackingProjectileDestroyed",
			this.onTrackingProjectileDestroyed.bind(this)
		)
	}

	private get validHero(): Nullable<Hero> {
		const hero = this.hero
		return hero !== undefined && hero.IsValid ? hero : undefined
	}

	protected get State() {
		return this.menu.State.value
	}

	private get allowOwnAttackThreat() {
		return this.menu.AbuseOnMyAttacks.value
	}

	private get forceCycleCatchUp() {
		return this.menu.ForceCycleCatchUp.value
	}

	private get holdDisassembleActive() {
		return this.menu.HoldDisassembleKey.isPressed
	}

	private get threatCooldownWindow() {
		return this.menu.ThreatCooldown.value / 100
	}

	private get recentDamageThreatWindow() {
		return this.menu.RecentDamageThreatWindow.value / 100
	}

	private get damageDebuffThreatWindow() {
		return this.menu.DamageDebuffThreatWindow.value / 100
	}

	private onTrackingProjectileCreated(projectile: TrackingProjectile) {
		this.upsertThreatProjectile(projectile, true)
	}

	private onTrackingProjectileUpdated(projectile: TrackingProjectile) {
		this.upsertThreatProjectile(projectile, false)
	}

	private onTrackingProjectileDestroyed(projectile: TrackingProjectile) {
		if (!this.State) {
			return
		}

		if (this.activeProjectiles.delete(projectile.ID)) {
			const wasOwnAttackProjectile = this.ownAttackProjectiles.delete(projectile.ID)
			if (!wasOwnAttackProjectile) {
				this.lastThreatTime = this.now
			}
		}
	}

	public GameEnded() {
		this.resetRuntimeState(true)
	}

	public PostDataUpdate(dt: number) {
		if (dt === 0) {
			return
		}

		if (!this.canRun()) {
			this.resetRuntimeState()
			return
		}

		const now = this.now
		this.ensureThreatCandidatesBootstrapped()
		this.cleanupProjectiles(now)

		const hero = this.hero!
		const isThreat = this.getThreatReason(hero) !== undefined

		const boots = this.getBoots()
		this.hasSeenTranquils ||= boots !== undefined
		this.updateAntiStickCycleState(boots, now)

		if (this.holdDisassembleActive) {
			if (boots !== undefined) {
				this.disassembleTranquils(DISASSEMBLE_CAUSES.HOLD_KEY)
			}
			return
		}

		const disassembleStatus = this.getTranquilsDisassembleStatus(boots, now)
		if (!disassembleStatus.canDisassemble) {
			return
		}

		if (isThreat) {
			if (boots !== undefined) {
				this.disassembleTranquils(DISASSEMBLE_CAUSES.THREAT)
			}
			return
		}

		if (boots === undefined) {
			this.tryReassembleTranquilsSequentially(now)
			return
		}
		this.nextReassembleUnlockAt = 0

		if (this.shouldPauseAntiStickCycleForOwnCast(hero)) {
			if (
				this.antiStickCycleState ===
				ANTI_STICK_CYCLE_STATE.AWAIT_DISASSEMBLE_CONFIRM
			) {
				this.resetAntiStickCyclePending(now)
			}
			return
		}

		this.processAntiStickCycle(boots, now)
	}

	private resetRuntimeState(clearThreatCandidates = false) {
		this.activeProjectiles.clear()
		this.ownAttackProjectiles.clear()
		this.lastCycleTime = 0
		this.antiStickCycleState = ANTI_STICK_CYCLE_STATE.IDLE
		this.antiStickCycleRetryAt = 0
		this.reassembleRetryAt = 0
		this.nextReassembleUnlockAt = 0
		this.lastThreatTime = 0
		this.ownAttackThreatUntil = 0
		this.damageThreatUntil = 0
		this.lastRecentDamageSample = 0
		this.hadDamageDebuff = false
		this.hasSeenTranquils = false
		this.actionSleeper.FullReset()
		if (clearThreatCandidates) {
			this.resetThreatCandidates()
		}
	}

	private cleanupProjectiles(now: number) {
		for (const [projectileID, dieTime] of this.activeProjectiles) {
			if (now > dieTime) {
				this.activeProjectiles.delete(projectileID)
				this.ownAttackProjectiles.delete(projectileID)
			}
		}
	}

	private onEntityCreated(entity: Entity) {
		this.tryTrackMeleeHeroThreatCandidate(entity)
		this.tryTrackMeleeCreepThreatCandidate(entity)
	}

	private onEntityDestroyed(entity: Entity) {
		if (entity instanceof Hero) {
			this.meleeHeroThreatCandidates.delete(entity)
		}
		if (entity instanceof Unit) {
			this.meleeCreepThreatCandidates.delete(entity)
		}
	}

	private onGameStarted() {
		this.resetThreatCandidates()
	}

	private ensureThreatCandidatesBootstrapped() {
		if (this.threatCandidatesBootstrapped) {
			return
		}

		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			this.tryTrackMeleeHeroThreatCandidate(enemy)
		}
		for (const creep of EntityManager.GetEntitiesByClass(Unit)) {
			this.tryTrackMeleeCreepThreatCandidate(creep)
		}
		this.threatCandidatesBootstrapped = true
	}

	private tryTrackMeleeHeroThreatCandidate(entity: Entity) {
		if (!(entity instanceof Hero) || !entity.IsValid || !entity.IsMelee) {
			return
		}

		this.meleeHeroThreatCandidates.add(entity)
	}

	private tryTrackMeleeCreepThreatCandidate(entity: Entity) {
		if (
			!(entity instanceof Unit) ||
			!entity.IsValid ||
			!entity.IsMelee ||
			!entity.IsCreep ||
			entity.IsHero ||
			entity.IsBuilding
		) {
			return
		}

		this.meleeCreepThreatCandidates.add(entity)
	}

	private resetThreatCandidates() {
		this.meleeHeroThreatCandidates.clear()
		this.meleeCreepThreatCandidates.clear()
		this.threatCandidatesBootstrapped = false
	}

	private getBoots() {
		const hero = this.validHero
		if (hero === undefined) {
			return undefined
		}

		return (
			hero.GetItemByName(ITEM_NAMES.TRANQUIL_BOOTS, true) ??
			hero.GetItemByName(ITEM_PATTERNS.TRANQUIL_BOOTS, true)
		)
	}

	private isTranquilsDisassembled(boots: Nullable<Item> = this.getBoots()): boolean {
		const hero = this.validHero
		if (hero === undefined || boots !== undefined || !this.hasSeenTranquils) {
			return false
		}

		for (const componentName of TRANQUIL_COMPONENTS) {
			if (hero.GetItemByName(componentName, true) === undefined) {
				return false
			}
		}

		return true
	}

	private getTranquilsCooldown(boots: Nullable<Item> = this.getBoots()): number {
		return boots?.Cooldown ?? 0
	}

	private getTranquilsDisassembleWindowRemaining(
		boots: Nullable<Item> = this.getBoots(),
		now: number = this.now
	): number {
		if (boots === undefined || boots.AssembledTime <= 0) {
			return 0
		}

		return Math.max(
			boots.AssembledTime + TIMINGS.INITIAL_DISASSEMBLE_WINDOW - now,
			0
		)
	}

	private getTranquilsDisassembleStatus(
		boots: Nullable<Item> = this.getBoots(),
		now: number = this.now
	) {
		const windowRemaining = this.getTranquilsDisassembleWindowRemaining(boots, now)
		const lockReason = this.getTranquilsDisassembleLockReason(boots, now)
		return {
			canDisassemble: lockReason === undefined,
			windowRemaining
		}
	}

	private shouldPauseAntiStickCycleForOwnCast(hero: Hero): boolean {
		return hero.IsInAbilityPhase || hero.IsChanneling
	}

	private updateAntiStickCycleState(
		boots: Nullable<Item> = this.getBoots(),
		now: number = this.now
	) {
		if (
			this.antiStickCycleState !==
			ANTI_STICK_CYCLE_STATE.AWAIT_DISASSEMBLE_CONFIRM
		) {
			return
		}

		const hero = this.hero
		if (
			hero !== undefined &&
			hero.IsValid &&
			this.shouldPauseAntiStickCycleForOwnCast(hero)
		) {
			return
		}

		if (this.isTranquilsDisassembled(boots)) {
			this.lastCycleTime = now
			this.resetAntiStickCyclePending()
			return
		}

		if (!this.canRunAntiStickCycle(boots, now)) {
			this.resetAntiStickCyclePending(now)
			return
		}

		if (now >= this.antiStickCycleRetryAt) {
			const forced = this.disassembleTranquils(
				DISASSEMBLE_CAUSES.ANTI_STICK_CYCLE,
				true,
				this.forceCycleCatchUp
			)
			if (forced) {
				this.antiStickCycleRetryAt = now + this.getAntiStickCycleRetryDelay()
			}
		}
	}

	private processAntiStickCycle(
		boots: Nullable<Item> = this.getBoots(),
		now: number = this.now
	) {
		if (
			this.antiStickCycleState ===
			ANTI_STICK_CYCLE_STATE.AWAIT_DISASSEMBLE_CONFIRM
		) {
			return
		}

		const cycleInterval = this.getAntiStickCycleInterval(boots, now)
		if (now < this.lastCycleTime + cycleInterval) {
			return
		}

		if (!this.canRunAntiStickCycle(boots, now)) {
			return
		}

		const forceCatchUp = this.forceCycleCatchUp && this.isAntiStickCycleOverdue(boots, now)
		const started = this.disassembleTranquils(
			DISASSEMBLE_CAUSES.ANTI_STICK_CYCLE,
			true,
			forceCatchUp
		)
		if (!started) {
			return
		}

		this.startAntiStickCyclePending(now)
	}

	private startAntiStickCyclePending(now: number = this.now) {
		this.antiStickCycleState =
			ANTI_STICK_CYCLE_STATE.AWAIT_DISASSEMBLE_CONFIRM
		this.antiStickCycleRetryAt = now + this.getAntiStickCycleRetryDelay()
	}

	private resetAntiStickCyclePending(now: number = this.now) {
		this.antiStickCycleState = ANTI_STICK_CYCLE_STATE.IDLE
		this.antiStickCycleRetryAt = 0
		// If cycle was interrupted without confirmation, postpone next run slightly
		// to avoid immediate resend spam in the same frame window.
		this.lastCycleTime = now
	}

	private getAntiStickCycleRetryDelay(): number {
		return Math.max(
			TIMINGS.CRITICAL_DISASSEMBLE_ORDER_COOLDOWN_MS / 1000,
			GameState.TickInterval
		)
	}

	private isAntiStickCycleOverdue(
		boots: Nullable<Item> = this.getBoots(),
		now: number = this.now
	): boolean {
		return now >= this.lastCycleTime + this.getAntiStickCycleInterval(boots, now)
	}

	private canRunAntiStickCycle(
		boots: Nullable<Item> = this.getBoots(),
		now: number = this.now
	): boolean {
		const disassembleStatus = this.getTranquilsDisassembleStatus(boots, now)
		const safetyLead = this.getAntiStickCycleSafetyLead()

		if (!disassembleStatus.canDisassemble) {
			return false
		}

		if (disassembleStatus.windowRemaining <= safetyLead) {
			return false
		}

		return true
	}

	private getAntiStickCycleInterval(
		boots: Nullable<Item> = this.getBoots(),
		now: number = this.now
	): number {
		const disassembleWindowLeft = this.getTranquilsDisassembleWindowRemaining(
			boots,
			now
		)
		const lagLead = this.getAntiStickCycleLagLead()
		const dynamicInterval = Math.max(
			disassembleWindowLeft - lagLead - 1.0,
			GameState.TickInterval
		)
		return Math.min(dynamicInterval, TIMINGS.CYCLE_INTERVAL)
	}

	private getAntiStickCycleLagLead(): number {
		const tick = GameState.TickInterval
		const inputLag = GameState.InputLag
		const incomingIOLag = GameState.GetIOLag(GameState.GetLatency())
		const jitter = Math.max(GameState.LatestTickDelta, tick)

		return Math.max(
			inputLag + incomingIOLag + jitter + tick,
			inputLag + tick * 2,
			incomingIOLag + tick * 2,
			0.1
		)
	}

	private getAntiStickCycleSafetyLead(): number {
		const tick = GameState.TickInterval
		const inputLag = GameState.InputLag
		const incomingIOLag = GameState.GetIOLag(GameState.GetLatency())
		const jitter = Math.max(GameState.LatestTickDelta, tick)
		const reassembleUnlockDelay =
			Math.max(TRANQUIL_COMPONENTS.length - 1, 0) *
			TIMINGS.REASSEMBLE_UNLOCK_DELAY_MAX
		const actionDelay =
			TIMINGS.DISASSEMBLE_ORDER_COOLDOWN_MS / 1000 +
			TIMINGS.REASSEMBLE_RETRY_DELAY +
			TIMINGS.COMBINE_ORDER_COOLDOWN_MS / 1000 +
			reassembleUnlockDelay

		return Math.max(
			inputLag + incomingIOLag + jitter + tick + actionDelay,
			inputLag + tick * 3 + actionDelay,
			incomingIOLag + tick * 3 + actionDelay,
			0.2
		)
	}

	private getTranquilsDisassembleLockReason(
		boots: Nullable<Item> = this.getBoots(),
		now: number = this.now
	): Nullable<string> {
		if (boots === undefined || boots.AssembledTime <= 0) {
			return undefined
		}

		const windowRemaining = this.getTranquilsDisassembleWindowRemaining(boots, now)
		if (windowRemaining <= TIMINGS.DISASSEMBLE_WINDOW_EPSILON) {
			return "disassemble window closed"
		}

		if (
			this.getTranquilsCooldown(boots) >
			windowRemaining + TIMINGS.DISASSEMBLE_WINDOW_EPSILON
		) {
			return "cooldown exceeds disassemble window"
		}

		return undefined
	}

	private onAttackStarted(unit: Unit, castPoint: number, _animationNames: string[]) {
		if (!this.State || !this.allowOwnAttackThreat) {
			return
		}

		const hero = this.hero
		if (
			!GameState.IsConnected ||
			!this.isUIGame ||
			hero === undefined ||
			!hero.IsValid ||
			!hero.IsAlive ||
			unit.Index !== hero.Index
		) {
			return
		}

		// Ignore ability/channel phases to avoid spell false-positives.
		if (hero.IsInAbilityPhase || hero.IsChanneling || !hero.IsAttacking) {
			return
		}

		const now = this.now
		const attackWindow = Math.max(castPoint, 0) + TIMINGS.OWN_ATTACK_THREAT_BUFFER
		this.ownAttackThreatUntil = Math.max(this.ownAttackThreatUntil, now + attackWindow)

		const cause = hero.IsMelee
			? DISASSEMBLE_CAUSES.ATTACK_START_MELEE
			: DISASSEMBLE_CAUSES.ATTACK_START_RANGED
		this.disassembleTranquils(cause)
	}

	private disassembleTranquils(
		cause: DisassembleCause,
		forceImmediate = false,
		bypassOrderCooldown = false
	): boolean {
		const boots = this.getBoots()
		const hero = this.hero
		if (boots === undefined) {
			return false
		}

		if (hero === undefined) {
			return false
		}

		const disassembleStatus = this.getTranquilsDisassembleStatus(boots, this.now)
		if (!disassembleStatus.canDisassemble) {
			return false
		}

		const isCriticalCause =
			cause !== DISASSEMBLE_CAUSES.ANTI_STICK_CYCLE || forceImmediate
		const disassembleSleeperKey = isCriticalCause
			? SLEEPER_KEYS.DISASSEMBLE_CRITICAL
			: SLEEPER_KEYS.DISASSEMBLE
		if (!bypassOrderCooldown && this.actionSleeper.Sleeping(disassembleSleeperKey)) {
			return false
		}

		// Threat-related disassemble must be immediate; forceImmediate overrides queueing.
		const queue = !isCriticalCause
		hero.DisassembleItem(boots, queue)
		this.actionSleeper.Sleep(
			isCriticalCause
				? TIMINGS.CRITICAL_DISASSEMBLE_ORDER_COOLDOWN_MS
				: TIMINGS.DISASSEMBLE_ORDER_COOLDOWN_MS,
			disassembleSleeperKey
		)
		if (cause !== DISASSEMBLE_CAUSES.ANTI_STICK_CYCLE) {
			this.lastCycleTime = this.now
		}
		return true
	}

	private tryReassembleTranquilsSequentially(now: number) {
		const hero = this.validHero
		if (hero === undefined) {
			return
		}

		if (now < this.reassembleRetryAt || now < this.nextReassembleUnlockAt) {
			return
		}

		const nextLockedComponentName =
			this.getNextLockedTranquilComponentName(hero)
		if (nextLockedComponentName === undefined) {
			this.nextReassembleUnlockAt = 0
			this.reassembleRetryAt = now + TIMINGS.REASSEMBLE_RETRY_DELAY
			return
		}

		if (this.unlockCombine(nextLockedComponentName)) {
			this.nextReassembleUnlockAt = now + this.getReassembleUnlockDelay()
		}
	}

	private getNextLockedTranquilComponentName(hero: Hero): Nullable<string> {
		for (const componentName of TRANQUIL_COMPONENTS) {
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
			TIMINGS.REASSEMBLE_UNLOCK_DELAY_MIN +
			Math.random() *
			(TIMINGS.REASSEMBLE_UNLOCK_DELAY_MAX - TIMINGS.REASSEMBLE_UNLOCK_DELAY_MIN)

		return Math.max(randomBaseDelay, pingSeconds + inputLag, 0.1)
	}

	private unlockCombine(itemName: string): boolean {
		const hero = this.hero
		const component = hero?.GetItemByName(itemName, true)
		if (hero === undefined || component === undefined || !component.IsCombineLocked) {
			return false
		}

		const key = `${SLEEPER_KEYS.UNLOCK_PREFIX}${itemName}`
		if (this.actionSleeper.Sleeping(key)) {
			return false
		}

		// Queue mode avoids hard interrupting current user-issued actions.
		hero.ItemSetCombineLock(component, false, true)
		this.actionSleeper.Sleep(TIMINGS.COMBINE_ORDER_COOLDOWN_MS, key)
		return true
	}

	private getThreatReason(hero: Hero): Nullable<string> {
		const now = this.now
		if (now - this.lastThreatTime < this.threatCooldownWindow) {
			return "threat cooldown window"
		}

		if (this.activeProjectiles.size > 0) {
			return `tracking projectiles active (${this.activeProjectiles.size})`
		}

		if (this.allowOwnAttackThreat && now < this.ownAttackThreatUntil) {
			return `own attack cast window (${(this.ownAttackThreatUntil - now).toFixed(2)}s)`
		}

		const damageThreatReason = this.getDamageThreatReason(hero, now)
		if (damageThreatReason !== undefined) {
			return damageThreatReason
		}

		for (const enemy of this.meleeHeroThreatCandidates) {
			if (!enemy.IsValid) {
				this.meleeHeroThreatCandidates.delete(enemy)
				continue
			}

			if (!this.isEnemyThreat(hero, enemy)) {
				continue
			}
			return `enemy attack nearby (${enemy.Name})`
		}

		for (const creep of this.meleeCreepThreatCandidates) {
			if (!creep.IsValid) {
				this.meleeCreepThreatCandidates.delete(creep)
				continue
			}

			if (!this.isCreepThreat(hero, creep)) {
				continue
			}
			return `creep attack nearby (${creep.Name})`
		}

		return undefined
	}

	private isEnemyThreat(hero: Hero, enemy: Hero) {
		if (enemy.Index === hero.Index) {
			return false
		}

		if (!enemy.IsValid || !enemy.IsAlive || !enemy.IsVisible) {
			return false
		}

		if (enemy.Team === hero.Team) {
			return false
		}

		// Ranged hero threats are handled by tracking projectiles.
		if (!enemy.IsMelee) {
			return false
		}

		if (enemy.Distance2D(hero) > RANGES.ENEMY_THREAT_RADIUS) {
			return false
		}

		if (!enemy.IsAttacking) {
			return false
		}

		const target = enemy.Target
		if (target !== undefined && target.Index !== hero.Index) {
			return false
		}

		return true
	}

	private isCreepThreat(hero: Hero, creep: Unit) {
		if (creep.Index === hero.Index) {
			return false
		}

		if (!creep.IsValid || !creep.IsAlive || !creep.IsVisible) {
			return false
		}

		if (!creep.IsCreep || creep.IsHero || creep.IsBuilding) {
			return false
		}

		if (creep.Team === hero.Team) {
			return false
		}

		// Ranged creep attacks are already covered by tracking projectiles.
		if (!creep.IsMelee) {
			return false
		}

		if (!creep.IsAttacking) {
			return false
		}

		const target = creep.Target
		if (target !== undefined && target.Index !== hero.Index) {
			return false
		}

		const threatRange =
			Math.max(creep.GetAttackRange(hero), 150) + RANGES.CREEP_THREAT_EXTRA_RANGE
		if (creep.Distance2D(hero) > threatRange) {
			return false
		}

		return true
	}

	private getDamageThreatReason(hero: Hero, now: number): Nullable<string> {
		const recentDamage = hero.RecentDamage
		if (recentDamage > 0 && recentDamage > this.lastRecentDamageSample) {
			
			const hasFriendlyDamageDebuff = hero.Buffs.some(
				b =>
					DAMAGE_DEBUFF_WHITELIST_SET.has(b.Name) &&
					b.Caster !== undefined &&
					b.Caster.Team === hero.Team
			)

			if (!hasFriendlyDamageDebuff) {
				this.damageThreatUntil = Math.max(
					this.damageThreatUntil,
					now + this.recentDamageThreatWindow
				)
			}
		}
		this.lastRecentDamageSample = recentDamage

		const damageDebuff = this.findEnemyDamageDebuff(hero)
		const damageDebuffActive = damageDebuff !== undefined

		// Start a short hold window when a debuff source appears.
		if (!this.hadDamageDebuff && damageDebuffActive) {
			this.damageThreatUntil = Math.max(
				this.damageThreatUntil,
				now + this.damageDebuffThreatWindow
			)
		}

		// Keep threat ON while periodic debuff source is actively present.
		if (damageDebuffActive) {
			this.hadDamageDebuff = true
			return `damage debuff (${damageDebuff})`
		}

		// Keep a short tail only after the source disappears.
		if (this.hadDamageDebuff) {
			this.damageThreatUntil = Math.max(
				this.damageThreatUntil,
				now + this.damageDebuffThreatWindow
			)
		}
		this.hadDamageDebuff = false

		if (now < this.damageThreatUntil) {
			const holdTime = Math.max(this.damageThreatUntil - now, 0).toFixed(2)
			return recentDamage > 0
				? `recent damage (${recentDamage}); hold (${holdTime}s)`
				: `damage hold window (${holdTime}s)`
		}

		return undefined
	}

	private findEnemyDamageDebuff(hero: Hero): Nullable<string> {
		for (const modifier of hero.Buffs) {
			if (!modifier.IsValid || !modifier.IsDebuff()) {
				continue
			}

			const caster = modifier.Caster
			const isOurDebuff = caster !== undefined && caster.Team === hero.Team
			const isWhitelisted = DAMAGE_DEBUFF_WHITELIST_SET.has(modifier.Name)


			if (isWhitelisted) {
				if (!isOurDebuff) {
					return modifier.Name
				}
				continue
			}

			// Любой другой дебафф, который наносит урон, считается угрозой
			if (modifier.NetworkDamage > 0) {
				return modifier.Name
			}
		}

		return undefined
	}

	private upsertThreatProjectile(
		projectile: TrackingProjectile,
		disassembleImmediately: boolean
	) {
		if (!this.State) {
			return
		}

		const hero = this.hero
		if (hero === undefined || !hero.IsValid) {
			return
		}

		const projectileSource = projectile.Source
		const isEnemyProjectileToMe =
			projectile.Target?.Index === hero.Index &&
			projectileSource instanceof Unit &&
			projectileSource.Team !== hero.Team
		const isOwnAttackProjectile =
			this.allowOwnAttackThreat &&
			projectile.IsAttack &&
			projectileSource?.Index === hero.Index &&
			projectile.Target instanceof Unit &&
			projectile.Target.Team !== hero.Team

		// Track only real attacks:
		// - incoming enemy projectile aimed at local hero
		// - own attack projectile while kiting as ranged hero
		if (!isEnemyProjectileToMe && !isOwnAttackProjectile) {
			return
		}

		const expireTime = this.getProjectileExpireTime(projectile)
		this.activeProjectiles.set(projectile.ID, expireTime)
		if (isOwnAttackProjectile) {
			this.ownAttackProjectiles.add(projectile.ID)
		} else {
			this.ownAttackProjectiles.delete(projectile.ID)
			this.lastThreatTime = this.now
		}

		if (disassembleImmediately) {
			this.disassembleTranquils(DISASSEMBLE_CAUSES.PROJECTILE_CREATED)
		}
	}

	private getProjectileExpireTime(projectile: TrackingProjectile): number {
		const now = this.now
		return projectile.ExpireTime > now
			? projectile.ExpireTime + 0.05
			: now + TIMINGS.PROJECTILE_LIFETIME
	}

}
