"""从 site/data.json 计算业务发现用到的数字，输出 site/findings.json。

只读看板同一份数据，保证看板和文档里的数字一致。运行：python scripts/analysis.py
"""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
D = json.loads((ROOT / "site/data.json").read_text())
START = pd.Timestamp(D["meta"]["start"])


def frame(t):
    f = pd.DataFrame(t)
    f["date"] = START + pd.to_timedelta(f["d"], unit="D")
    f["month"] = f["date"].dt.to_period("M")
    f["v"] = f["v"] / 100
    f["country"] = [D["countries"][i] for i in f["c"]]
    return f


O, R = frame(D["orders"]), frame(D["returns"])
P1 = (pd.Period("2009-12"), pd.Period("2010-11"))  # 前 12 个月
P2 = (pd.Period("2010-12"), pd.Period("2011-11"))  # 近 12 个月


def sel(f, p):
    return f[(f["month"] >= p[0]) & (f["month"] <= p[1])]


def kpi(o, r):
    known = o[o["u"] >= 0]
    n_orders = known.groupby("u").size()
    return {
        "gmv": o["v"].sum(), "orders": len(o), "aov": o["v"].sum() / len(o),
        "returns": r["v"].sum(), "return_rate": r["v"].sum() / o["v"].sum(),
        "net": o["v"].sum() - r["v"].sum(),
        "customers": int(known["u"].nunique()),
        "repeat_rate": float((n_orders >= 2).mean()),
        "no_id_gmv_share": o.loc[o["u"] < 0, "v"].sum() / o["v"].sum(),
    }


out = {}
out["kpi_p1"], out["kpi_p2"] = kpi(sel(O, P1), sel(R, P1)), kpi(sel(O, P2), sel(R, P2))
out["kpi_all"] = kpi(O, R)

# 1. 国家结构：英国 vs 海外
o2, o1 = sel(O, P2), sel(O, P1)
uk = lambda f: f[f["country"] == "United Kingdom"]
ov = lambda f: f[f["country"] != "United Kingdom"]
out["country"] = {
    "uk_share_p2": uk(o2)["v"].sum() / o2["v"].sum(),
    "uk_yoy": uk(o2)["v"].sum() / uk(o1)["v"].sum() - 1,
    "ov_yoy": ov(o2)["v"].sum() / ov(o1)["v"].sum() - 1,
    "uk_aov_p2": uk(o2)["v"].mean(), "ov_aov_p2": ov(o2)["v"].mean(),
    "ov_customer_share_p2": ov(o2).query("u>=0")["u"].nunique() / o2.query("u>=0")["u"].nunique(),
    "ov_gmv_share_p2": ov(o2)["v"].sum() / o2["v"].sum(),
    "top_overseas_p2": ov(o2).groupby("country")["v"].sum().sort_values(ascending=False).head(5).round(0).to_dict(),
    "top_overseas_customers_p2": ov(o2).query("u>=0").groupby("country")["u"].nunique().sort_values(ascending=False).to_dict(),
    "nl_gmv_share_of_overseas_p2": o2.loc[o2["country"] == "Netherlands", "v"].sum() / ov(o2)["v"].sum(),
    "ov_orders_per_customer_p2": len(ov(o2).query("u>=0")) / ov(o2).query("u>=0")["u"].nunique(),
    "uk_orders_per_customer_p2": len(uk(o2).query("u>=0")) / uk(o2).query("u>=0")["u"].nunique(),
}

# 2. 季节性：近 12 个月里 9–11 月占比，节日品类集中度
m = o2.groupby("month")["v"].sum()
out["season"] = {
    "sep_nov_share_p2": m[[pd.Period("2011-09"), pd.Period("2011-10"), pd.Period("2011-11")]].sum() / m.sum(),
    "peak_month": str(m.idxmax()), "peak_vs_low": m.max() / m.min(), "low_month": str(m.idxmin()),
    "monthly_p2": {str(k): round(v, 0) for k, v in m.items()},
}
cat = pd.DataFrame(D["cat"], columns=["m", "c", "k", "s", "r"])
cat["month"] = [pd.Period(D["months"][i]) for i in cat["m"]]
cat["cat"] = [D["categories"][i] for i in cat["k"]]
c2 = cat[(cat["month"] >= P2[0]) & (cat["month"] <= P2[1])]
fest = c2[c2["cat"] == "节日派对"]
out["season"]["festive_sep_nov_share"] = fest[fest["month"].dt.month.isin([9, 10, 11])]["s"].sum() / fest["s"].sum()
out["season"]["festive_share_of_gmv_sep_nov"] = fest[fest["month"].dt.month.isin([9, 10, 11])]["s"].sum() / c2[c2["month"].dt.month.isin([9, 10, 11])]["s"].sum()

# 3. 退货：集中度 + 国家差异 + 品类差异
r2 = sel(R, P2)
rs = r2["v"].sort_values(ascending=False)
out["returns"] = {
    "n_return_invoices_p2": len(r2),
    "top10_share_p2": rs.head(10).sum() / rs.sum(),
    "top1_p2": rs.iloc[0], "top1_date": str(r2.loc[rs.index[0], "date"].date()),
    "return_rate_ex_top10_p2": (rs.sum() - rs.head(10).sum()) / o2["v"].sum(),
    "return_order_rate_p2": len(r2) / len(o2),
}
rc = r2.groupby("country")["v"].sum() / o2.groupby("country")["v"].sum()
big = o2.groupby("country")["v"].sum().sort_values(ascending=False).head(10).index
out["returns"]["by_country_top10_p2"] = rc[big].round(4).to_dict()
cs = c2.groupby("cat")[["s", "r"]].sum()
out["returns"]["by_cat_p2"] = (cs["r"] / cs["s"]).round(4).to_dict()

# 4. 复购与同期群
known = O[O["u"] >= 0]
first = known.groupby("u")["month"].min().rename("first")
k = known.join(first, on="u")
k["age"] = (k["month"] - k["first"]).apply(lambda x: x.n)
coh = k.groupby(["first", "age"])["u"].nunique().unstack(fill_value=0)
ret = coh.div(coh[0], axis=0)
cohorts = [p for p in ret.index if pd.Period("2010-01") <= p <= pd.Period("2011-10")]
out["cohort"] = {
    "m1_mean_2010_01_to_2011_10": float(ret.loc[cohorts, 1].mean()),
    "m1_min": float(ret.loc[cohorts, 1].min()), "m1_max": float(ret.loc[cohorts, 1].max()),
    "first_cohort_size": int(coh.loc[pd.Period("2009-12"), 0]),
    "first_cohort_m12": float(ret.loc[pd.Period("2009-12"), 12]),
}
cust2 = o2.query("u>=0").groupby("u")["v"].agg(["size", "sum"])
out["cohort"]["repeaters_share_p2"] = float((cust2["size"] >= 2).mean())
out["cohort"]["repeaters_gmv_share_p2"] = float(cust2.loc[cust2["size"] >= 2, "sum"].sum() / cust2["sum"].sum())
srt = cust2["sum"].sort_values(ascending=False)
out["cohort"]["top10pct_customers_gmv_share_p2"] = float(srt.head(int(len(srt) * 0.1)).sum() / srt.sum())
# 新客首单后 90 天内是否复购（首单在 2010-01-01 至 2011-08-31，保证观察窗口完整）
fd = known.groupby("u")["date"].min()
newc = fd[(fd >= "2010-01-01") & (fd <= "2011-08-31")]
kk = known[known["u"].isin(newc.index)].join(fd.rename("fd"), on="u")
second = kk[(kk["date"] > kk["fd"]) & (kk["date"] <= kk["fd"] + pd.Timedelta(days=90))]["u"].nunique()
out["cohort"]["new_90d_repeat"] = second / len(newc)
out["cohort"]["new_customers_n"] = int(len(newc))

# 无客户编号订单的 GMV 占比（按月）
nid = (O.assign(nv=O["v"].where(O["u"] < 0, 0)).groupby("month")[["nv", "v"]].sum())
nid = (nid["nv"] / nid["v"]).sort_values(ascending=False)
out["no_id_monthly_top3"] = {str(k): v for k, v in nid.head(3).items()}

# 5. 口径对比：同一个"销售额"不同口径差多少（近 12 个月）
out["definition_gap_p2"] = {
    "gmv": o2["v"].sum(), "net": o2["v"].sum() - r2["v"].sum(),
    "net_vs_gmv": (o2["v"].sum() - r2["v"].sum()) / o2["v"].sum() - 1,
}

# 口径瀑布：从"原始非退货行直接加总"一步步走到"净销售额"（需要原始数据，见 build_data.py）
raw_pq = ROOT / "data/raw/online_retail_II.parquet"
if raw_pq.exists():
    raw = pd.read_parquet(raw_pq)
    raw = raw[(raw["InvoiceDate"] >= "2010-12-01") & (raw["InvoiceDate"] < "2011-12-01")]
    raw = raw.assign(amt=raw["Quantity"] * raw["Price"])
    nc = raw[~raw["Invoice"].str.startswith("C")]
    a = nc["amt"].sum()
    nc = nc.drop_duplicates(subset=["Invoice", "StockCode", "Description", "Quantity", "InvoiceDate", "Price", "Customer ID", "Country"])
    b = nc["amt"].sum()
    nc = nc[nc["StockCode"].str.match(r"^\d{5}")]
    c = nc["amt"].sum()
    out["definition_gap_p2"].update({
        "raw_non_return_sum": a, "after_dedup": b, "after_product_only": c,
        "raw_vs_net": (o2["v"].sum() - r2["v"].sum()) / a - 1,
    })


def clean(x):
    if isinstance(x, dict):
        return {str(k): clean(v) for k, v in x.items()}
    if hasattr(x, "item"):
        x = x.item()
    return round(x, 4) if isinstance(x, float) else x

(ROOT / "site/findings.json").write_text(json.dumps(clean(out), ensure_ascii=False, indent=1))
print(json.dumps(clean(out), ensure_ascii=False, indent=1))
