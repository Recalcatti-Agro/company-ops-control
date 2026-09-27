from decimal import ROUND_DOWN, Decimal

from .models import CapitalEvent, Investor


def allocate_by_weights(total, weights):
    """Split `total` (Decimal) across `weights` (list of Decimal, any positive scale)
    so the parts sum exactly to `total`. Largest-remainder method, cent-precise."""
    total_cents = int((total * 100).to_integral_value(rounding=ROUND_DOWN))
    weight_sum = sum(weights) or Decimal("1")
    raw = [(total_cents * w) / weight_sum for w in weights]
    floors = [int(r.to_integral_value(rounding=ROUND_DOWN)) for r in raw]
    remainder = total_cents - sum(floors)
    remainders = sorted(range(len(weights)), key=lambda i: raw[i] - floors[i], reverse=True)
    for i in remainders[:remainder]:
        floors[i] += 1
    return [Decimal(c) / 100 for c in floors]


def cap_table(as_of=None, exclude_payment=None):
    investors = list(Investor.objects.filter(active=True))
    capitals = {inv.id: inv.capital_usd(as_of=as_of, exclude_payment=exclude_payment) for inv in investors}
    total_capital = sum(capitals.values(), Decimal("0"))
    rows = []
    for inv in investors:
        capital = capitals[inv.id]
        if total_capital > Decimal("0"):
            pct = capital / total_capital * Decimal("100")
        elif investors:
            pct = Decimal("100") / Decimal(len(investors))
        else:
            pct = Decimal("0")
        rows.append({"investor": inv, "capital_usd": capital, "percentage": pct})
    return rows, total_capital


def add_months(date, months):
    month = date.month - 1 + months
    year = date.year + month // 12
    month = month % 12 + 1
    import calendar

    day = min(date.day, calendar.monthrange(year, month)[1])
    return date.replace(year=year, month=month, day=day)
