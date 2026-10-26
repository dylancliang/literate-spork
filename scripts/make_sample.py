import csv, random
from datetime import date, timedelta

random.seed(7)

prefixes = [("火焰", "fire", "火焰"), ("寒冰", "ice", "冰霜"), ("雷霆", "thunder", "雷电"),
            ("暗影", "shadow", "暗影"), ("圣光", "holy", "神圣"), ("龙鳞", "dragon", "龙炎"),
            ("风暴", "storm", "风"), ("星辰", "star", "星光"), ("血月", "bloodmoon", "流血"),
            ("翡翠", "jade", "自然")]
statuses = ["灼烧", "冰冻", "麻痹", "沉默", "中毒", "眩晕"]

types = {
    "武器": ("wpn", ["剑", "长弓", "法杖", "战斧", "匕首"], [
        "攻击力提升{0}点，暴击率提高{1}%。",
        "对目标造成{0}点{el}伤害，并有{1}%几率使其{st}。",
        "装备后普通攻击附带{el}效果，持续{0}回合。",
        "<color=#FF4500>专属武器</color>：攻击力提升{0}%。",
    ]),
    "防具": ("arm", ["护甲", "头盔", "战靴", "盾牌"], [
        "防御力提升{0}点。",
        "受到的{el}伤害降低{0}%。",
        "生命值上限提高{0}点，持续{1}回合。",
        "受到致命伤害时，保留1点生命值。\\n每场战斗限触发一次。",
    ]),
    "饰品": ("acc", ["戒指", "项链", "护符"], [
        "暴击伤害提高{0}%。",
        "每回合恢复{0}点生命值。",
        "<color=#FFD700>套装效果</color>：全属性提升{0}%。",
        "{el}抗性提高{0}%，闪避率提高{1}%。",
    ]),
    "消耗品": ("con", ["药水", "卷轴", "礼包"], [
        "立即恢复{0}点生命值。",
        "使用后获得经验值x{0}。",
        "<color=gold>限时</color>赠送，内含金币x{0}。",
        "使用后{1}秒内移动速度提升{0}%。",
    ]),
}
rarities = ["普通", "稀有", "史诗", "传说"]

characters = [
    ("暗影刺客·夜", "来自东方的神秘刺客，擅长在黑暗中一击必杀。"),
    ("圣光骑士·莉娜", "王国最年轻的骑士团长，誓死守护公主。\\n被动：队友生命值低于{0}%时为其施加护盾。"),
    ("雷霆法师·艾伦", "掌控雷电之力的天才法师，攻击可连锁{0}个目标。"),
    ("寒冰女王", ""),
    ("龙骑士·凯", "与巨龙签订契约的战士，大招造成{0}点龙炎伤害。"),
]

dev_notes = ["", "", "", "balance pass v2", "check icon size", "reuse from event 3",
             "TODO: confirm with design", "", "localize before launch", ""]

rows = []
used = set()
start = date(2026, 6, 1)
i = 1001
while len(rows) < 95:
    t = random.choice(list(types))
    code, bases, tmpls = types[t]
    p_cn, p_en, el = random.choice(prefixes)
    base = random.choice(bases)
    name = p_cn + base
    if name in used:
        continue
    used.add(name)
    desc = random.choice(tmpls).format("{0}", "{1}", el=el, st=random.choice(statuses))
    if random.random() < 0.06:
        desc = ""
    rows.append({
        "id": i,
        "item_key": f"{code}_{p_en}_{len(rows)+1:03d}",
        "名称": name,
        "类型": t,
        "稀有度": random.choice(rarities),
        "描述": desc,
        "价格": random.choice([0, 50, 120, 300, 500, 880, 1200, 2500, 5000]),
        "上架日期": (start + timedelta(days=random.randint(0, 150))).isoformat(),
        "icon": f"icons/{code}_{p_en}_{len(rows)+1:03d}.png",
        "dev_note": random.choice(dev_notes),
    })
    i += 1

for cname, cdesc in characters:
    rows.append({"id": i, "item_key": f"chr_{i}", "名称": cname, "类型": "角色",
                 "稀有度": "传说", "描述": cdesc, "价格": 6480,
                 "上架日期": "2026-09-15", "icon": f"icons/chr_{i}.png", "dev_note": ""})
    i += 1

# a couple of mixed-language edge cases
rows[10]["名称"] = "VIP月卡"
rows[10]["描述"] = "购买后30天内每日领取钻石x{0}，VIP经验+{1}。"
rows[20]["名称"] = "S级强化石"

with open("sample_input.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]))
    w.writeheader()
    w.writerows(rows)
print(len(rows), "rows")
