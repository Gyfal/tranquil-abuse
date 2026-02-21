# Tranquil Abuse

## Runtime Models

- `TranquilAbuseModel`
- `KhandaPhylacteryAbuseModel`

## English

### `TranquilAbuseModel`

- Automatically disassembles Tranquil Boots when nearby threat is detected.
- Reassembles boots when threat is gone by unlocking components (`Ring of Regen`, `Boots`, `Wind Lace`).
- Tracks multiple attack projectiles and keeps threat state until all tracked projectiles are gone.
- Optional `Abuse on my attacks` mode: treats your own attack projectiles/state as threat.
- Has anti-stick cycle logic to keep disassemble availability alive.
- Supports hold-to-disassemble key and timing controls in menu.

### `KhandaPhylacteryAbuseModel`

- Prioritizes Khanda on cast, then disassembles in cast/projectile windows for Phylactery and reassembles.
- Intercepts target-cast orders to track cast/projectile windows.
- Skips forced disassemble while live Phylactery cooldown is active.
- Uses queued unlock/reassemble logic.

### Menu

- `Utility -> Tranquil Abuse` controls Tranquil model.
- `Utility -> Khanda Abuse` controls Khanda/Phylactery model.

## Русский

### Модели

- `TranquilAbuseModel`
- `KhandaPhylacteryAbuseModel`

### `TranquilAbuseModel`

- Автоматически разбирает Tranquil Boots при обнаружении угрозы рядом.
- Собирает ботинок обратно после исчезновения угрозы через снятие lock с компонентов (`Ring of Regen`, `Boots`, `Wind Lace`).
- Отслеживает несколько атакующих tracking-снарядов и держит состояние угрозы, пока все они не исчезнут.
- Опциональный режим `Abuse on my attacks`: считает угрозой ваши собственные атакующие снаряды/состояние атаки.
- Есть anti-stick цикл для поддержки доступности разборки.
- Поддерживает режим удержания разборки и настраиваемые тайминги в меню.

### `KhandaPhylacteryAbuseModel`

- Разбирает Khanda перед кастом для прока Phylactery и затем собирает обратно.
- Перехватывает target-касты, при необходимости переотправляет ордер и отслеживает окна каста/снаряда.
- Не форсит разборку, пока активен живой кулдаун Phylactery.
- Использует queue-логику для unlock/сборки.

### Меню

- `Utility -> Tranquil Abuse` управляет моделью Tranquil.
- `Utility -> Khanda Abuse` управляет моделью Khanda/Phylactery.

