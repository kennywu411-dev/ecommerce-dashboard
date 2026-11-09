"""从 UCI Online Retail II 原始数据生成看板数据（site/data.json）和清洗日志。

口径见 docs/指标定义.md。运行：python scripts/build_data.py
"""
import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW_XLSX = ROOT / "data/raw/online_retail_II.xlsx"
RAW_PQ = ROOT / "data/raw/online_retail_II.parquet"
OUT = ROOT / "site/data.json"
LOG = ROOT / "docs/清洗日志.md"

START, END = pd.Timestamp("2009-12-01"), pd.Timestamp("2011-12-01")  # 左闭右开：24 个完整自然月

COUNTRY_ZH = {
    "United Kingdom": "英国", "EIRE": "爱尔兰", "Netherlands": "荷兰", "Germany": "德国", "France": "法国",
    "Australia": "澳大利亚", "Spain": "西班牙", "Switzerland": "瑞士", "Sweden": "瑞典", "Denmark": "丹麦",
    "Belgium": "比利时", "Norway": "挪威", "Portugal": "葡萄牙", "Japan": "日本", "Channel Islands": "海峡群岛",
    "Italy": "意大利", "Finland": "芬兰", "Cyprus": "塞浦路斯", "Austria": "奥地利", "Greece": "希腊",
    "Singapore": "新加坡", "Hong Kong": "中国香港", "Israel": "以色列", "Poland": "波兰", "United Arab Emirates": "阿联酋",
    "Unspecified": "未注明", "Canada": "加拿大", "Iceland": "冰岛", "USA": "美国", "Malta": "马耳他",
    "Lithuania": "立陶宛", "Bahrain": "巴林", "RSA": "南非", "Thailand": "泰国", "Korea": "韩国",
    "Czech Republic": "捷克", "Brazil": "巴西", "Lebanon": "黎巴嫩", "European Community": "欧洲共同体",
    "Saudi Arabia": "沙特阿拉伯", "Bermuda": "百慕大", "Nigeria": "尼日利亚", "West Indies": "西印度群岛",
}

# 品类：原数据没有品类字段，按商品名关键词归类，先匹配先得（规则透明、可复查）
CATEGORY_RULES = [
    ("节日派对", r"CHRISTMAS|XMAS|ADVENT|SANTA|REINDEER|EASTER|BUNTING|PARTY|BIRTHDAY|CRACKER|HALLOWEEN"),
    ("灯饰蜡烛", r"LIGHT|LANTERN|CANDLE|LAMP|HLDR|INCENSE"),
    ("家居装饰", r"HOT WATER BOTTLE"),
    ("包袋收纳", r"\bBAGS?\b|SHOPPER|STORAGE|\bBOX(ES)?\b|\bTINS?\b|BASKET|\bJARS?\b|\bCASES?\b|HAMPER|DRAWER|CABINET|CRATE"),
    ("厨房餐饮", r"CAKE|\bMUGS?\b|\bCUPS?\b|PLATE|BOWL|\bTEA\b|TEACUP|CUTLERY|BAKING|LUNCH|BOTTLE|GLASS|NAPKIN|COASTER|SPOON|\bJUG\b|KITCHEN|PANTRY|RECIPE|TRAY|BEAKER|TUMBLER|APRON|OVEN|CHOPSTICK|JELLY|SUGAR|BISCUIT|STRAWS"),
    ("家居装饰", r"HEART|SIGN|FRAME|CLOCK|DOORMAT|\bMAT\b|CUSHION|ORNAMENT|DECORATION|HANGING|WICKER|MIRROR|VASE|GARDEN|PARASOL|BOARD|BLOCK WORD|PLANT|\bDOOR\b|HOOK|WREATH|CHIME|DOORSTOP|QUILT|THROW|PHOTO|SHELF"),
    ("文具纸品", r"\bCARDS?\b|PAPER|WRAP|NOTEBOOK|\bPENS?\b|PENCIL|STICKER|ENVELOPE|CRAFT|TISSUE|\bTAGS?\b|JOURNAL|RIBBON|NOTE|BOOK|ERASER|RULER|STAMP|CHALK"),
    ("儿童玩具", r"\bTOYS?\b|GAME|DOLL|CHILDREN|CHILDS|\bKIDS?\b|SPACEBOY|PUZZLE|JIGSAW|SKITTLES|DOMINO|TEDDY|FELTCRAFT|PLAYHOUSE|BUBBLES|SOLDIER|DINOSAUR|PAINT|\bBALL\b"),
    ("饰品配饰", r"NECKLACE|BRACELET|EARRING|\bRING\b|JEWEL|\bHAIR\b|CHARM|PURSE|UMBRELLA|SCARF|BROOCH|DIAMANTE|BEADS|WALLET|KEYRING"),
]
CATEGORIES = ["节日派对", "灯饰蜡烛", "家居装饰", "包袋收纳", "厨房餐饮", "文具纸品", "儿童玩具", "饰品配饰", "其他"]


def categorize(desc: str) -> str:
    d = str(desc).upper()
    for name, pat in CATEGORY_RULES:
        if re.search(pat, d):
            return name
    return "其他"


def load_raw() -> pd.DataFrame:
    if RAW_PQ.exists():
        return pd.read_parquet(RAW_PQ)
    sheets = pd.read_excel(RAW_XLSX, sheet_name=None, dtype={"Invoice": str, "StockCode": str})
    df = pd.concat(sheets.values(), ignore_index=True)
    df["Description"] = df["Description"].astype("string")
    df.to_parquet(RAW_PQ, index=False)
    return df


def main():
    df = load_raw()
    df["amt"] = df["Quantity"] * df["Price"]
    log = []

    def step(name, mask, why):
        nonlocal df
        removed = df[~mask]
        log.append((name, len(removed), round(removed["amt"].sum(), 2), why))
        df = df[mask].copy()

    log.append(("原始数据", len(df), round(df["amt"].sum(), 2), "两个工作表合并"))
    step("去除完全重复行", ~df.duplicated(subset=["Invoice", "StockCode", "Description", "Quantity", "InvoiceDate", "Price", "Customer ID", "Country"]), "同一单同一商品同一时间同数量同价格完全一致，视为重复导出")
    step("只保留商品行", df["StockCode"].str.match(r"^\d{5}"), "去掉邮费（POST/DOT/C2）、手工调整（M/ADJUST/B）、平台费（AMAZONFEE）、银行手续费、折扣、样品、礼品卡、测试商品等非商品行")
    step("单价大于 0", df["Price"] > 0, "单价为 0 的行多为库存调整、破损登记，不是成交")
    is_c = df["Invoice"].str.startswith("C")
    step("去除非退货单里的负数量", is_c | (df["Quantity"] > 0), "非 C 开头却为负数的行为库存调整")
    step("限定 24 个完整自然月", (df["InvoiceDate"] >= START) & (df["InvoiceDate"] < END), "2011-12 只有 9 天数据，不完整月会让趋势和同比失真")

    df["is_return"] = df["Invoice"].str.startswith("C")
    df["cat"] = df["Description"].map(categorize)
    df["month"] = df["InvoiceDate"].dt.to_period("M").astype(str)

    countries = df.groupby("Country")["amt"].apply(lambda s: s.abs().sum()).sort_values(ascending=False).index.tolist()
    cidx = {c: i for i, c in enumerate(countries)}
    custs = sorted(df["Customer ID"].dropna().unique())
    uidx = {c: i for i, c in enumerate(custs)}  # 客户 ID 重新编号，不输出原编号

    def invoice_table(sub):
        g = sub.groupby("Invoice").agg(t=("InvoiceDate", "min"), c=("Country", "first"), u=("Customer ID", "first"), v=("amt", "sum"))
        g = g.sort_values("t")
        return {
            "d": ((g["t"].dt.normalize() - START).dt.days).astype(int).tolist(),
            "c": g["c"].map(cidx).astype(int).tolist(),
            "u": g["u"].map(lambda x: -1 if pd.isna(x) else uidx[x]).astype(int).tolist(),
            "v": (g["v"].abs() * 100).round().astype(int).tolist(),  # 金额以便士存整数，避免浮点误差
        }

    sales, rets = df[~df["is_return"]], df[df["is_return"]]
    cat = df.assign(s=df["amt"].where(~df["is_return"], 0), r=(-df["amt"]).where(df["is_return"], 0)) \
        .groupby(["month", "Country", "cat"])[["s", "r"]].sum().reset_index()
    months = pd.period_range(START, END - pd.Timedelta(days=1), freq="M").astype(str).tolist()
    cat_rows = [[months.index(r.month), cidx[r.Country], CATEGORIES.index(r.cat), int(round(r.s * 100)), int(round(r.r * 100))]
                for r in cat.itertuples()]

    cov = sales.groupby("cat")["amt"].sum() / sales["amt"].sum()
    data = {
        "meta": {
            "source": "UCI Machine Learning Repository - Online Retail II (Daqing Chen, 2019), DOI 10.24432/C5CG6D, CC BY 4.0",
            "start": str(START.date()), "end_exclusive": str(END.date()), "currency": "GBP",
            "category_coverage_other": round(float(cov.get("其他", 0)), 4),
        },
        "months": months,
        "countries": countries,
        "countries_zh": [COUNTRY_ZH.get(c, c) for c in countries],
        "categories": CATEGORIES,
        "orders": invoice_table(sales),
        "returns": invoice_table(rets),
        "cat": cat_rows,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))

    lines = ["# 清洗日志（由 scripts/build_data.py 自动生成）", "", "| 步骤 | 影响行数 | 影响金额（英镑，数量×单价） | 原因 |", "|---|---:|---:|---|"]
    lines += [f"| {a} | {b:,} | {c:,.2f} | {d} |" for a, b, c, d in log]
    lines += ["", f"清洗后：销售行 {len(sales):,}，退货行 {len(rets):,}；销售订单 {sales['Invoice'].nunique():,}，退货单 {rets['Invoice'].nunique():,}。", "",
              "品类关键词归类后各品类占 GMV：", ""]
    lines += [f"- {k}：{v:.1%}" for k, v in cov.sort_values(ascending=False).items()]
    LOG.write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    print("data.json", OUT.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
