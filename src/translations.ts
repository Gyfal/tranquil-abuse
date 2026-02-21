import { Menu, Utils } from "github.com/octarine-public/wrapper/index"

function load(name: string) {
	try {
		return new Map<string, string>(
			Object.entries(Utils.readJSON(`translations/${name}.json`))
		)
	} catch {
		return new Map<string, string>()
	}
}

Menu.Localization.AddLocalizationUnit("russian", load("ru"))
Menu.Localization.AddLocalizationUnit("english", load("en"))
Menu.Localization.AddLocalizationUnit("chinese", load("cn"))
