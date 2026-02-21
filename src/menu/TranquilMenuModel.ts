import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"
import { TIMINGS } from "../constants"

export class TranquilMenuModel {
	public readonly State: Menu.Toggle
	public readonly AbuseOnMyAttacks: Menu.Toggle
	public readonly ForceCycleCatchUp: Menu.Toggle
	public readonly HoldDisassembleKey: Menu.KeyBind
	public readonly ThreatCooldown: Menu.Slider
	public readonly RecentDamageThreatWindow: Menu.Slider
	public readonly DamageDebuffThreatWindow: Menu.Slider

	private readonly baseNode = Menu.AddEntry("Utility")
	private readonly tree = this.baseNode.AddNode(
		"Tranquil Abuse",
		ImageData.GetItemTexture("item_tranquil_boots"),
		"Tranquil_Abuse_Tooltip"
	)
	private readonly timingTree = this.tree.AddNode("Tranquil_Abuse_Timings")

	constructor() {
		this.tree.SortNodes = false
		this.timingTree.SortNodes = false
		this.State = this.tree.AddToggle("State", true)
		this.AbuseOnMyAttacks = this.tree.AddToggle(
			"Tranquil_Abuse_OnMyAttack",
			true,
			"Tranquil_Abuse_OnMyAttack_Tooltip"
		)
		this.ForceCycleCatchUp = this.tree.AddToggle(
			"Tranquil_Abuse_ForceCycleCatchUp",
			false,
			"Force disassemble when cycle is overdue and current actions block it"
		)
		this.HoldDisassembleKey = this.tree.AddKeybind(
			"Tranquil_Abuse_HoldDisassembleKey",
			"N",
			"Tranquil_Abuse_HoldDisassembleKey_Tooltip"
		)

		this.ThreatCooldown = this.timingTree.AddSlider(
			"Tranquil_Abuse_ThreatCooldown",
			Math.round(TIMINGS.THREAT_COOLDOWN * 100),
			0,
			300
		)
		this.RecentDamageThreatWindow = this.timingTree.AddSlider(
			"Tranquil_Abuse_RecentDamageThreatWindow",
			Math.round(TIMINGS.RECENT_DAMAGE_THREAT_WINDOW * 100),
			0,
			300
		)
		this.DamageDebuffThreatWindow = this.timingTree.AddSlider(
			"Tranquil_Abuse_DamageDebuffThreatWindow",
			Math.round(TIMINGS.DAMAGE_DEBUFF_THREAT_WINDOW * 100),
			0,
			300
		)
	}
}
