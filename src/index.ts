import "./translations"

import { EventsSDK } from "github.com/octarine-public/wrapper/index"

import { MenuManager } from "./menu"
import { KhandaPhylacteryAbuseModel } from "./models/KhandaPhylacteryAbuseModel"
import { TranquilAbuseModel } from "./models/TranquilAbuseModel"

new (class AbuseApp {
	private readonly menu = new MenuManager()
	private readonly models = [
		new TranquilAbuseModel(this.menu.Tranquil),
		new KhandaPhylacteryAbuseModel(this.menu.Khanda)
	] as const

	constructor() {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
	}

	private PostDataUpdate(dt: number) {
		for (const model of this.models) {
			model.PostDataUpdate(dt)
		}
	}

	private GameEnded() {
		for (const model of this.models) {
			model.GameEnded()
		}
	}
})()
