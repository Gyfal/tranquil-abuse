import { KhandaMenuModel } from "./menu/KhandaMenuModel"
import { TranquilMenuModel } from "./menu/TranquilMenuModel"

export class MenuManager {
	public readonly Tranquil = new TranquilMenuModel()
	public readonly Khanda = new KhandaMenuModel()
}
