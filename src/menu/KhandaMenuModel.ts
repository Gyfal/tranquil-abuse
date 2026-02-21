import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

export class KhandaMenuModel {
	public readonly State: Menu.Toggle

	private readonly baseNode = Menu.AddEntry("Utility")
	private readonly tree = this.baseNode.AddNode(
		"Khanda Abuse",
		ImageData.GetItemTexture("item_angels_demise"),
		"Khanda_Abuse_Tooltip"
	)

	constructor() {
		this.tree.SortNodes = false
		this.State = this.tree.AddToggle("State", true)
	}
}
