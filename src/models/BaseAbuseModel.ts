import {
	DOTAGameUIState,
	GameState,
	LocalPlayer
} from "github.com/octarine-public/wrapper/index"

export abstract class BaseAbuseModel {
	protected get now() {
		return GameState.RawGameTime
	}

	protected get hero() {
		return LocalPlayer?.Hero
	}

	protected get isUIGame() {
		return GameState.UIState === DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME
	}

	protected abstract get State(): boolean

	protected canRun() {
		const hero = this.hero
		return (
			GameState.IsConnected &&
			this.State &&
			this.isUIGame &&
			!LocalPlayer?.IsSpectator &&
			hero !== undefined &&
			hero.IsValid
		)
	}
}
