"""
Migra datos del esquema viejo (proyecto productivo, modelo A) al modelo nuevo
(Recalcatti v2, modelo B). Lee de una base Postgres restaurada a partir de un
backup de producción (--source-dsn) y escribe en la base configurada para este
proyecto (settings.DATABASES["default"]) usando el ORM de Django.

No migra `CashMovement` ni `CapitalContribution(kind=EXPENSE|REINVESTMENT)`
como filas propias: en v1 eran tablas derivadas (side effects materializados);
en v2 los mismos efectos se recalculan solos a partir de Payment/Expense/
CapitalEvent. Los casos sin categoría propia en v2 (retiros que en v1 no
afectaban capital, reinversiones grabadas en USD por el mecanismo viejo de
liquidación) se migran como Expense/Transfer, con nota explicando el porqué —
ver `_migrate_investor_withdrawal_cashouts`, `_migrate_non_reinvested_leftovers`
y `_migrate_old_settlement_transfers`.
"""

import re
from decimal import Decimal

import psycopg
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core import calc, models, private_data, work_types


def D(value):
    return None if value is None else Decimal(str(value))


class Command(BaseCommand):
    help = "Migra datos del backup de producción (modelo viejo) a este proyecto (modelo B)."

    def add_arguments(self, parser):
        parser.add_argument("--source-dsn", required=True, help="DSN Postgres de la base restaurada")
        parser.add_argument("--wipe", action="store_true", help="Borra los datos migrables actuales antes de migrar")

    def handle(self, *args, **opts):
        # Correcciones de datos (alias de clientes, trabajos y cobros de v1): privado/.
        self.datos = private_data.load("migracion_v1_datos.py")
        try:
            self.src = psycopg.connect(opts["source_dsn"], row_factory=psycopg.rows.dict_row)
        except Exception as exc:
            raise CommandError(f"No se pudo conectar a la base de origen: {exc}")

        self.gaps = []

        with transaction.atomic():
            if opts["wipe"]:
                self._wipe()

            ars_account, usd_account = self._ensure_accounts()
            self.account_by_currency = {"ARS": ars_account, "USD": usd_account}

            investor_map = self._migrate_investors()
            self._migrate_users(investor_map)
            client_map = self._migrate_clients()
            self._migrate_exchange_rates()
            job_map = self._migrate_jobs(client_map)
            invoice_map, payment_map = self._migrate_collections(job_map)
            self._migrate_distributions(investor_map, payment_map)
            self._migrate_manual_capital_events(investor_map)
            self._migrate_adjustment_transfers()
            self._migrate_investor_withdrawal_cashouts(investor_map)
            self._migrate_non_reinvested_leftovers(investor_map)
            self._migrate_old_settlement_transfers()
            purchase_map = self._migrate_purchases()
            bill_map = self._migrate_bills(purchase_map)
            self._migrate_expenses(investor_map, bill_map, job_map)
            self._recompute_shareholder_splits()
            self._recompute_statuses(invoice_map, bill_map)

        self._report(investor_map, client_map, job_map, invoice_map, payment_map, purchase_map, bill_map)

    # ---------- setup ----------

    def _wipe(self):
        self.stdout.write("Borrando datos migrables existentes...")
        models.Transfer.objects.all().delete()
        models.CapitalEvent.objects.all().delete()
        models.Expense.objects.all().delete()
        models.Payment.objects.all().delete()
        models.Bill.objects.all().delete()
        models.Purchase.objects.all().delete()
        models.Invoice.objects.all().delete()
        models.Job.objects.all().delete()
        models.Client.objects.all().delete()
        models.Investor.objects.all().delete()
        models.ExchangeRate.objects.all().delete()
        models.User.objects.filter(is_superuser=False).delete()

    def _ensure_accounts(self):
        ars, _ = models.Account.objects.get_or_create(name="Caja ARS", defaults={"currency": models.Currency.ARS})
        usd, _ = models.Account.objects.get_or_create(name="Caja USD", defaults={"currency": models.Currency.USD})
        return ars, usd

    def _fetchall(self, sql, params=None):
        with self.src.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()

    # ---------- entities without dependencies ----------

    def _migrate_investors(self):
        rows = self._fetchall("select id, name, active from core_investor")
        mapping = {}
        for row in rows:
            obj = models.Investor.objects.create(name=row["name"], active=row["active"])
            mapping[row["id"]] = obj
        self.stdout.write(f"Investors: {len(mapping)}")
        return mapping

    def _migrate_users(self, investor_map):
        rows = self._fetchall(
            "select id, username, email, password, is_staff, is_superuser, is_active "
            "from auth_user where not (username = any(%s))",
            (list(getattr(self.datos, "SKIP_USERS", ())),),
        )
        by_name = {inv.name.lower(): inv for inv in investor_map.values()}
        created = 0
        for row in rows:
            role = models.User.Role.ADMIN if (row["is_staff"] or row["is_superuser"]) else models.User.Role.INVESTOR
            user, made = models.User.objects.get_or_create(
                username=row["username"],
                defaults={
                    "email": row["email"] or "",
                    "password": row["password"],
                    "role": role,
                    "is_staff": row["is_staff"],
                    "is_superuser": row["is_superuser"],
                    "is_active": row["is_active"],
                },
            )
            if made:
                created += 1
            investor = by_name.get(row["username"].lower())
            if investor and not investor.user_id:
                investor.user = user
                investor.save(update_fields=["user"])
        self.stdout.write(f"Users: {created} creados (contraseñas originales preservadas; sin los de SKIP_USERS)")

    def _migrate_clients(self):
        rows = self._fetchall("select id, name, active, notes from core_client")
        mapping = {}
        aliased = []
        for row in rows:
            if row["name"] in self.datos.CLIENT_ALIASES:
                aliased.append(row)
                continue
            obj = models.Client.objects.create(name=row["name"], active=row["active"], notes=row["notes"] or "")
            mapping[row["id"]] = obj
        by_name = {c.name: c for c in mapping.values()}
        for row in aliased:
            mapping[row["id"]] = by_name[self.datos.CLIENT_ALIASES[row["name"]]]
        for v1_name, info in self.datos.CLIENT_INFO.items():
            client = by_name.get(v1_name)
            if client is None:
                self.gaps.append(f"CLIENT_INFO: no hay cliente '{v1_name}' en v1")
                continue
            for field, value in info.items():
                setattr(client, field, value)
            client.save()
        self.placeholder_client = models.Client.objects.create(
            name="Sin cliente / a confirmar",
            active=True,
            notes=getattr(
                self.datos, "PLACEHOLDER_CLIENT_NOTES",
                "Creado por la migración: había un Job en producción sin cliente.",
            ),
        )
        self.stdout.write(
            f"Clients: {len(mapping) - len(aliased)} (+ 1 placeholder para el job sin cliente; "
            f"{len(aliased)} unificados por alias: {', '.join(r['name'] for r in aliased) or '—'})"
        )
        return mapping

    def _migrate_exchange_rates(self):
        rows = self._fetchall("select date, ars_per_usd, source, notes from core_exchangerate")
        objs = [
            models.ExchangeRate(date=r["date"], ars_per_usd=D(r["ars_per_usd"]), source=r["source"], notes=r["notes"] or "")
            for r in rows
        ]
        models.ExchangeRate.objects.bulk_create(objs, ignore_conflicts=True)
        self.stdout.write(f"ExchangeRate: {len(objs)}")

    # ---------- jobs ----------

    def _migrate_jobs(self, client_map):
        by_name = {}
        rows = self._fetchall("select id, name from core_client")
        for r in rows:
            by_name[r["name"].lower()] = client_map[r["id"]]

        rows = self._fetchall(
            "select id, date, end_date, client, hectares, work_type, status, notes from core_job"
        )
        mapping = {}
        for row in rows:
            fix = self.datos.JOB_FIXES.get(row["id"], {})
            if "hectares" in fix and D(fix["hectares"]) != D(row["hectares"]):
                self.gaps.append(
                    f"Job #{row['id']} hectáreas corregidas al migrar: {row['hectares']} → "
                    f"{fix['hectares']} (ver JOB_FIXES)"
                )
            row["hectares"] = fix.get("hectares", row["hectares"])
            row["work_type"] = fix.get("work_type", row["work_type"])
            client = by_name.get((row["client"] or "").lower()) or self.placeholder_client
            # El tipo se guarda estandarizado; semilla/producto a su campo, cultivo a notas.
            work_type, product, crop = work_types.parse_legacy(row["work_type"])
            notes = row["notes"] or ""
            if crop:
                notes = f"Cultivo: {crop}. {notes}".strip()
            obj = models.Job.objects.create(
                date=row["date"],
                end_date=row["end_date"],
                client=client,
                location=fix.get("location", ""),
                hectares=D(row["hectares"]),
                work_type=work_type,
                product=product,
                notes=notes,
                status=models.Job.Status.DONE,
            )
            mapping[row["id"]] = obj
        self.stdout.write(f"Jobs: {len(mapping)}")
        return mapping

    # ---------- invoices / payments ----------

    def _migrate_collections(self, job_map):
        collections = self._fetchall(
            "select id, parent_collection_id, collection_date, amount_ars, fx_ars_usd, amount_usd, "
            "status, collected_currency, collected_amount_original, collected_fx_ars_usd, "
            "collected_amount_usd, tax_loss_usd from core_jobcollection order by id"
        )
        self.collection_rescale = {}  # old collection id -> (total ARS v1, total ARS corregido)
        for row in collections:
            fix = self.datos.COLLECTION_FIXES.get(row["id"])
            if not fix:
                continue
            if "fx_ars_usd" in fix:
                row["fx_ars_usd"] = D(fix["fx_ars_usd"])
                row["amount_usd"] = (D(row["amount_ars"]) / row["fx_ars_usd"]).quantize(Decimal("0.01"))
            if "collected_amount_original" in fix:
                old = D(row["collected_amount_original"])
                row["collected_amount_original"] = D(fix["collected_amount_original"])
                row["collected_amount_usd"] = (
                    row["collected_amount_original"] / D(row["collected_fx_ars_usd"])
                ).quantize(Decimal("0.01"))
                self.collection_rescale[row["id"]] = (old, row["collected_amount_original"])
            self.gaps.append(f"JobCollection #{row['id']} corregida al migrar: {fix} (ver COLLECTION_FIXES)")
        jobs_by_collection = {}
        for r in self._fetchall("select jobcollection_id, job_id from core_jobcollection_jobs"):
            jobs_by_collection.setdefault(r["jobcollection_id"], []).append(r["job_id"])
        for collection_id, extra in self.datos.EXTRA_COLLECTION_JOBS.items():
            jobs_by_collection.setdefault(collection_id, []).extend(extra)
            self.gaps.append(
                f"JobCollection #{collection_id}: se le asociaron los jobs {extra} de v1 (ver EXTRA_COLLECTION_JOBS)"
            )

        invoice_map = {}   # old root collection id -> Invoice
        payment_map = {}   # old collection id (any COLLECTED row) -> Payment
        self.gap_no_root_jobs = 0

        roots = [c for c in collections if c["parent_collection_id"] is None]
        for root in roots:
            job_ids = jobs_by_collection.get(root["id"], [])
            if not job_ids:
                self.gap_no_root_jobs += 1
                continue
            jobs = [job_map[j] for j in job_ids]
            invoice = models.Invoice.objects.create(
                client=jobs[0].client,
                date=root["collection_date"],
                amount_original=D(root["amount_ars"]),
                currency=models.Currency.ARS,
                fx_ars_usd=D(root["fx_ars_usd"]),
                amount_usd=D(root["amount_usd"]),
                status=models.Invoice.Status.OPEN,
            )
            invoice.jobs.set(jobs)
            invoice_map[root["id"]] = invoice

        for row in collections:
            if row["status"] != "COLLECTED":
                continue
            root_id = row["parent_collection_id"] or row["id"]
            invoice = invoice_map.get(root_id)
            if invoice is None:
                continue
            currency = row["collected_currency"] or "ARS"
            account = self.account_by_currency[currency]
            payment = models.Payment.objects.create(
                invoice=invoice,
                account=account,
                date=row["collection_date"],
                amount_original=D(row["collected_amount_original"]),
                currency=currency,
                fx_ars_usd=D(row["collected_fx_ars_usd"]),
                amount_usd=D(row["collected_amount_usd"]),
                tax_loss_usd=D(row["tax_loss_usd"]) or Decimal("0"),
            )
            payment_map[row["id"]] = payment

        self.stdout.write(f"Invoices: {len(invoice_map)} · Payments: {len(payment_map)}")
        return invoice_map, payment_map

    # ---------- capital events ----------

    def _migrate_distributions(self, investor_map, payment_map):
        rows = self._fetchall(
            "select jd.id, jd.collection_id, jd.investor_id, jd.fx_ars_usd, jd.reinvest_to_cash_ars, "
            "jd.reinvest_to_cash_usd, jd.work_amount_usd, jd.shareholder_amount_usd, jd.notes, "
            "jd.work_amount_ars, jd.shareholder_amount_ars, "
            "jc.collection_date "
            "from core_jobdistribution jd join core_jobcollection jc on jc.id = jd.collection_id"
        )
        self._rescale_fixed_distributions(rows)
        created = 0
        skipped_no_payment = 0
        skipped_zero = 0
        # Montos por trabajo/accionista de v1, por (payment, investor): los usa
        # _recompute_shareholder_splits para rehacer la parte accionaria.
        self.dist_source = {}
        for row in rows:
            payment = payment_map.get(row["collection_id"])
            investor = investor_map.get(row["investor_id"])
            if payment is None or investor is None:
                skipped_no_payment += 1
                continue
            self.dist_source[(payment.id, investor.id)] = {
                "work_ars": D(row["work_amount_ars"]),
                "shareholder_ars": D(row["shareholder_amount_ars"]),
                "work_usd": D(row["work_amount_usd"]),
                "fx": D(row["fx_ars_usd"]),
            }
            # v2 reinvierte el 100% del reparto. Si en v1 el inversor se llevó parte
            # sin reinvertir, se acredita el reparto completo acá y lo retirado se
            # migra aparte como RESCUE (ver _migrate_non_reinvested_leftovers).
            amount_ars = D(row["reinvest_to_cash_ars"])
            amount_usd = D(row["reinvest_to_cash_usd"])
            full_ars = D(row["work_amount_ars"]) + D(row["shareholder_amount_ars"])
            if full_ars - amount_ars > 1:
                amount_ars = full_ars
                amount_usd = D(row["work_amount_usd"]) + D(row["shareholder_amount_usd"])
            if not amount_usd or amount_usd <= 0:
                skipped_zero += 1
                continue
            models.CapitalEvent.objects.create(
                date=row["collection_date"],
                investor=investor,
                kind=models.CapitalEvent.Kind.JOB_DISTRIBUTION,
                amount_original=amount_ars,
                currency=models.Currency.ARS,
                fx_ars_usd=D(row["fx_ars_usd"]),
                amount_usd=amount_usd,
                payment=payment,
                work_amount_usd=D(row["work_amount_usd"]),
                shareholder_amount_usd=D(row["shareholder_amount_usd"]),
                notes=row["notes"] or "",
            )
            created += 1
        self.stdout.write(
            f"CapitalEvent (reparto de cobro): {created} "
            f"({skipped_no_payment} sin payment mapeado, {skipped_zero} en 0)"
        )

    def _rescale_fixed_distributions(self, rows):
        """Para los cobros corregidos en COLLECTION_FIXES, reescala el reparto de v1
        al monto corregido: mismo % trabajo/accionista y mismas proporciones entre
        inversores, exacto al centavo."""
        for collection_id, (old_total, new_total) in self.collection_rescale.items():
            group = [r for r in rows if r["collection_id"] == collection_id]
            if not group:
                continue
            work = [D(r["work_amount_ars"]) for r in group]
            share = [D(r["shareholder_amount_ars"]) for r in group]
            new_work_total, new_share_total = calc.allocate_by_weights(new_total, [sum(work), sum(share)])
            new_work = calc.allocate_by_weights(new_work_total, work)
            new_share = calc.allocate_by_weights(new_share_total, share)
            for r, w, sh in zip(group, new_work, new_share):
                withdrawn = D(r["work_amount_ars"]) + D(r["shareholder_amount_ars"]) - D(r["reinvest_to_cash_ars"])
                fx = D(r["fx_ars_usd"])
                r["work_amount_ars"], r["shareholder_amount_ars"] = w, sh
                r["reinvest_to_cash_ars"] = w + sh - withdrawn
                r["work_amount_usd"] = (w / fx).quantize(Decimal("0.01"))
                r["shareholder_amount_usd"] = (sh / fx).quantize(Decimal("0.01"))
                r["reinvest_to_cash_usd"] = (r["reinvest_to_cash_ars"] / fx).quantize(Decimal("0.01"))

    def _migrate_manual_capital_events(self, investor_map):
        rows = self._fetchall(
            "select cc.id, cc.date, cc.kind, cc.amount_usd, cc.notes, cc.investor_id, "
            "cm.currency, cm.amount_original, cm.fx_ars_usd "
            "from core_capitalcontribution cc "
            "join core_cashmovement cm on cm.id = cc.cash_movement_id "
            "where cc.kind in ('DIRECT','WITHDRAWAL')"
        )
        created = 0
        for row in rows:
            investor = investor_map.get(row["investor_id"])
            if investor is None:
                continue
            currency = row["currency"] or "ARS"
            kind = models.CapitalEvent.Kind.CONTRIBUTION if row["kind"] == "DIRECT" else models.CapitalEvent.Kind.RESCUE
            models.CapitalEvent.objects.create(
                date=row["date"],
                investor=investor,
                kind=kind,
                amount_original=D(row["amount_original"]),
                currency=currency,
                fx_ars_usd=D(row["fx_ars_usd"]),
                amount_usd=D(row["amount_usd"]),
                account=self.account_by_currency[currency],
                notes=row["notes"] or "",
            )
            created += 1
        self.stdout.write(f"CapitalEvent (aporte/rescate manual): {created}")

    def _migrate_adjustment_transfers(self):
        """CashMovement categoría ADJUSTMENT sin inversor: en v1 son ajustes sueltos,
        pero en la práctica los que vienen de a pares (mismo día, un OUT en una
        moneda y un IN en la otra) son una conversión entre cajas (ej. comprar
        USD con ARS) — eso sí tiene equivalente limpio en v2: Transfer."""
        rows = self._fetchall(
            "select id, date, direction, currency, amount_original, notes from core_cashmovement "
            "where category = 'ADJUSTMENT' and investor_id is null order by date, id"
        )
        used = set()
        created = 0
        self.gap_unpaired_adjustments = []
        for out_row in rows:
            if out_row["id"] in used or out_row["direction"] != "OUT":
                continue
            match = next(
                (
                    r for r in rows
                    if r["id"] not in used and r["id"] != out_row["id"] and r["direction"] == "IN"
                    and r["date"] == out_row["date"] and r["currency"] != out_row["currency"]
                ),
                None,
            )
            if match is None:
                self.gap_unpaired_adjustments.append(out_row)
                continue
            models.Transfer.objects.create(
                date=out_row["date"],
                from_account=self.account_by_currency[out_row["currency"]],
                to_account=self.account_by_currency[match["currency"]],
                amount_from=D(out_row["amount_original"]),
                amount_to=D(match["amount_original"]),
                notes=out_row["notes"] or match["notes"] or "",
            )
            used.add(out_row["id"])
            used.add(match["id"])
            created += 1
        for r in rows:
            if r["id"] not in used and r["direction"] == "IN" and r not in self.gap_unpaired_adjustments:
                self.gap_unpaired_adjustments.append(r)
        self.stdout.write(f"Transfer (conversión entre cajas): {created}")

    def _migrate_investor_withdrawal_cashouts(self, investor_map):
        """CashMovement categoría INVESTOR_WITHDRAWAL: plata real que salió del
        banco para pagarle a un inversor. En v1 no bajaba su capital, pero era un
        error: es un rescate como cualquier otro, así que se migra como RESCUE
        (resta caja y capital)."""
        rows = self._fetchall(
            "select id, date, currency, amount_original, fx_ars_usd, amount_usd, investor_id, notes "
            "from core_cashmovement where category = 'INVESTOR_WITHDRAWAL' and direction = 'OUT'"
        )
        created = 0
        for row in rows:
            investor = investor_map.get(row["investor_id"])
            currency = row["currency"] or "ARS"
            if investor is None:
                self.gaps.append(f"INVESTOR_WITHDRAWAL #{row['id']} sin inversor, no migrado")
                continue
            models.CapitalEvent.objects.create(
                date=row["date"],
                investor=investor,
                kind=models.CapitalEvent.Kind.RESCUE,
                amount_original=D(row["amount_original"]),
                currency=currency,
                fx_ars_usd=D(row["fx_ars_usd"]) or Decimal("1"),
                amount_usd=D(row["amount_usd"]),
                account=self.account_by_currency[currency],
                notes=(row["notes"] or "Retiro") + " (en v1 no había bajado capital)",
            )
            created += 1
        self.stdout.write(f"CapitalEvent (rescate, retiro que en v1 no bajaba capital): {created}")

    def _migrate_non_reinvested_leftovers(self, investor_map):
        """Filas de JobDistribution donde work_amount+shareholder_amount es mayor
        a reinvest_to_cash: la diferencia se pagó de inmediato (retirada), pero
        en v1 nunca quedó registrada como salida de caja en ningún lado. El
        reparto completo ya se acreditó como capital en _migrate_distributions;
        lo retirado se migra como RESCUE (resta caja y capital)."""
        rows = self._fetchall(
            "select jd.investor_id, jd.fx_ars_usd, jd.collection_id, "
            "(jd.work_amount_ars + jd.shareholder_amount_ars - jd.reinvest_to_cash_ars) as gap_ars, "
            "(jd.work_amount_usd + jd.shareholder_amount_usd - jd.reinvest_to_cash_usd) as gap_usd, "
            "jc.collection_date "
            "from core_jobdistribution jd join core_jobcollection jc on jc.id = jd.collection_id "
            "where (jd.work_amount_ars + jd.shareholder_amount_ars - jd.reinvest_to_cash_ars) > 1"
        )
        created = 0
        for row in rows:
            investor = investor_map.get(row["investor_id"])
            if investor is None:
                self.gaps.append(f"Reparto no reinvertido del cobro #{row['collection_id']} sin inversor, no migrado")
                continue
            models.CapitalEvent.objects.create(
                date=row["collection_date"],
                investor=investor,
                kind=models.CapitalEvent.Kind.RESCUE,
                amount_original=D(row["gap_ars"]),
                currency=models.Currency.ARS,
                fx_ars_usd=D(row["fx_ars_usd"]) or Decimal("1"),
                amount_usd=D(row["gap_usd"]),
                account=self.account_by_currency["ARS"],
                notes=f"Reparto no reinvertido (cobro #{row['collection_id']}). "
                "Detectado al migrar: la app anterior nunca registró esta salida de caja.",
            )
            created += 1
        self.stdout.write(f"CapitalEvent (rescate, reparto no reinvertido en v1): {created}")

    def _migrate_old_settlement_transfers(self):
        """9 CashMovement PROFIT_REINVESTMENT en USD, todos del mecanismo viejo de
        liquidación por tags [settlement:id]. Esa plata era ARS que en su momento
        se convirtió y depositó en USD — igual que la transferencia de
        _migrate_adjustment_transfers, solo que grabada distinto por el código
        viejo. Se agrupan por cobro (settlement) para armar una transferencia por
        conversión real, no una por inversor."""
        # El CashMovement viejo no guarda collection_id — se resuelve vía el
        # texto "[settlement:N]" que el mecanismo de liquidación anterior dejaba
        # en las notas.
        rows = self._fetchall(
            "select notes, date, currency, amount_original from core_cashmovement "
            "where category = 'PROFIT_REINVESTMENT' and currency = 'USD'"
        )
        import re

        by_collection: dict[int, dict] = {}
        for row in rows:
            match = re.search(r"\[settlement:(\d+)\]", row["notes"] or "")
            if not match:
                continue
            collection_id = int(match.group(1))
            by_collection.setdefault(collection_id, {"date": row["date"], "usd": Decimal("0")})
            by_collection[collection_id]["usd"] += D(row["amount_original"])

        created = 0
        for collection_id, info in by_collection.items():
            ars_total = self._fetchall(
                "select sum(reinvest_to_cash_ars) as total from core_jobdistribution where collection_id = %s",
                (collection_id,),
            )[0]["total"]
            models.Transfer.objects.create(
                date=info["date"],
                from_account=self.account_by_currency["ARS"],
                to_account=self.account_by_currency["USD"],
                amount_from=D(ars_total),
                amount_to=info["usd"],
                notes=f"Detectado al migrar: conversión histórica grabada por el mecanismo de "
                f"liquidación viejo (cobro #{collection_id}), nunca hubo dólares distintos a esto.",
            )
            created += 1
        self.stdout.write(f"Transfer (conversiones viejas vía settlement tags): {created}")

    # ---------- purchases / bills / expenses ----------

    def _migrate_purchases(self):
        """Migra las compras, salvo las de pago único.

        v1 permitía ligar un gasto directo a una compra, sin cuota en el medio
        (compras chicas pagadas en el acto: Starlink, anemómetro, etc.). En v2 una
        compra solo tiene sentido si hay algo que seguir (cuotas o pago diferido),
        así que esas compras no se migran: queda solo el gasto, con la categoría
        de la compra en sus notas (ver _migrate_expenses).

        Al revés, una compra sin cuotas todavía impaga (ej. Drone T100, pago
        diferido) se migra con 1 cuota, así aparece en Cuentas a pagar."""
        rows = self._fetchall(
            "select id, created_date, concept, category, total_amount, total_currency, "
            "fx_ars_usd, total_amount_usd, installment_count, first_due_date, status, notes "
            "from core_purchase"
        )
        with_bills = {
            r["purchase_id"]
            for r in self._fetchall("select distinct purchase_id from core_paymentobligation where purchase_id is not null")
        }
        with_direct_expenses = {
            r["purchase_id"]
            for r in self._fetchall(
                "select distinct purchase_id from core_expense "
                "where purchase_id is not null and payment_obligation_id is null"
            )
        }
        self.single_payment_purchases = {}
        self.deferred_purchases = 0
        mapping = {}
        for row in rows:
            if row["id"] in with_direct_expenses and row["id"] not in with_bills:
                self.single_payment_purchases[row["id"]] = row
                continue
            deferred = (
                row["installment_count"] == 0
                and row["status"] == "ACTIVE"
                and row["id"] not in with_bills
                and row["id"] not in with_direct_expenses
            )
            if deferred:
                row = {**row, "installment_count": 1, "first_due_date": row["first_due_date"] or row["created_date"]}
            obj = models.Purchase.objects.create(
                date=row["created_date"],
                concept=row["concept"],
                category=row["category"] or "",
                total_amount=D(row["total_amount"]),
                currency=row["total_currency"],
                fx_ars_usd=D(row["fx_ars_usd"]),
                total_amount_usd=D(row["total_amount_usd"]),
                installment_count=row["installment_count"],
                first_due_date=row["first_due_date"],
                status=row["status"],
                notes=row["notes"] or "",
            )
            if deferred:
                models.Bill.objects.create(
                    purchase=obj,
                    source=models.Bill.Source.PURCHASE_INSTALLMENT,
                    installment_number=1,
                    installment_total=1,
                    due_date=obj.first_due_date,
                    amount_original=obj.total_amount,
                    currency=obj.currency,
                    estimated_amount_usd=obj.total_amount_usd or obj.total_amount,
                    concept=f"{obj.concept} · cuota 1/1",
                )
                self.deferred_purchases += 1
            mapping[row["id"]] = obj
        self.stdout.write(
            f"Purchases: {len(mapping)} (+ {len(self.single_payment_purchases)} de pago único migradas solo como gasto; "
            f"{self.deferred_purchases} de pago diferido pasadas a 1 cuota)"
        )
        return mapping

    def _migrate_bills(self, purchase_map):
        rows = self._fetchall(
            "select id, concept, source, purchase_id, installment_number, installment_total, "
            "due_date, amount, currency, estimated_amount_usd, status, notes "
            "from core_paymentobligation"
        )
        mapping = {}
        for row in rows:
            obj = models.Bill.objects.create(
                concept=row["concept"] or "",
                source=row["source"],
                purchase=purchase_map.get(row["purchase_id"]),
                installment_number=row["installment_number"],
                installment_total=row["installment_total"],
                due_date=row["due_date"],
                amount_original=D(row["amount"]),
                currency=row["currency"],
                estimated_amount_usd=D(row["estimated_amount_usd"]),
                status=row["status"],
                notes=row["notes"] or "",
            )
            mapping[row["id"]] = obj
        self.stdout.write(f"Bills: {len(mapping)}")
        return mapping

    def _migrate_expenses(self, investor_map, bill_map, job_map):
        rows = self._fetchall(
            "select id, date, concept, amount, currency, fx_ars_usd, amount_usd, paid_by, "
            "notes, payer_investor_id, payment_obligation_id, purchase_id, job_id from core_expense"
        )
        created = 0
        self.gap_expense_purchase_only = 0
        for row in rows:
            notes = row["notes"] or ""
            if row["purchase_id"] and not row["payment_obligation_id"]:
                purchase = self.single_payment_purchases.get(row["purchase_id"])
                if purchase:
                    tag = f"[compra de pago único en v1 #{purchase['id']}: {purchase['category'] or 'sin categoría'}]"
                    notes = f"{notes}\n{tag}".strip()
                else:
                    self.gap_expense_purchase_only += 1
            currency = row["currency"]
            paid_by = row["paid_by"]
            account = self.account_by_currency[currency] if paid_by == "CASH" else None
            investor = investor_map.get(row["payer_investor_id"]) if paid_by == "INVESTOR" else None
            models.Expense.objects.create(
                date=row["date"],
                concept=row["concept"],
                amount_original=D(row["amount"]),
                currency=currency,
                fx_ars_usd=D(row["fx_ars_usd"]),
                amount_usd=D(row["amount_usd"]),
                bill=bill_map.get(row["payment_obligation_id"]),
                job=job_map.get(row["job_id"]),
                paid_by=paid_by,
                account=account,
                investor=investor,
                notes=notes,
            )
            created += 1
        self.stdout.write(f"Expenses: {created}")

    # ---------- post-processing ----------

    def _recompute_shareholder_splits(self):
        """Rehace la parte accionaria de cada reparto con el capital ya corregido.

        v1 repartía la parte accionaria según el cap table a la fecha de fin del
        trabajo (máx. end_date/date de los jobs del cobro), con capital =
        reinversiones + gastos pagados de su bolsillo − rescates. Como v1 no
        restaba algunos retiros (ver _migrate_investor_withdrawal_cashouts), los
        repartos posteriores al retiro le dieron de más a ese inversor. Acá se recalcula con la misma
        regla sobre los datos ya migrados, en orden cronológico (cada reparto
        corregido alimenta el cap table de los siguientes). El total del cobro y
        la parte por trabajo no cambian; solo se redistribuye la parte accionaria."""
        investors = list(models.Investor.objects.filter(active=True))
        payments = (
            models.Payment.objects.filter(capital_events__kind=models.CapitalEvent.Kind.JOB_DISTRIBUTION)
            .distinct()
            .order_by("date", "id")
        )
        self.split_changes = []
        for payment in payments:
            ref_date = payment.cap_table_reference_date()
            capitals = [
                max(inv.capital_usd(as_of=ref_date, exclude_payment=payment), Decimal("0")) for inv in investors
            ]
            weights = capitals if sum(capitals) > 0 else [Decimal("1")] * len(investors)

            sources = {inv.id: self.dist_source.get((payment.id, inv.id)) for inv in investors}
            shareholder_total_ars = sum((src["shareholder_ars"] for src in sources.values() if src), Decimal("0"))
            fx = next((src["fx"] for src in sources.values() if src), payment.fx_ars_usd)
            new_shares = calc.allocate_by_weights(shareholder_total_ars, weights)

            events = {
                e.investor_id: e
                for e in payment.capital_events.filter(kind=models.CapitalEvent.Kind.JOB_DISTRIBUTION)
            }
            new_usd = [(ars / fx).quantize(Decimal("0.01")) for ars in new_shares]
            old_usd = [
                (events[inv.id].shareholder_amount_usd or Decimal("0")) if inv.id in events else Decimal("0")
                for inv in investors
            ]
            if all(abs(n - o) <= Decimal("0.05") for n, o in zip(new_usd, old_usd)):
                continue  # igual que en v1 salvo redondeo: no tocar

            deltas = {}
            for inv, new_sh_ars, new_sh_usd in zip(investors, new_shares, new_usd):
                src = sources[inv.id] or {"work_ars": Decimal("0"), "shareholder_ars": Decimal("0"), "work_usd": Decimal("0")}
                event = events.get(inv.id)
                if event is None and new_sh_usd <= 0:
                    continue
                old_usd = event.amount_usd if event else Decimal("0")
                withdrawn_ars = (event.amount_original - src["work_ars"] - src["shareholder_ars"]) if event else Decimal("0")
                if event is None:
                    event = models.CapitalEvent(
                        date=payment.date,
                        investor=inv,
                        kind=models.CapitalEvent.Kind.JOB_DISTRIBUTION,
                        currency=models.Currency.ARS,
                        fx_ars_usd=fx,
                        payment=payment,
                        work_amount_usd=Decimal("0"),
                    )
                event.amount_original = src["work_ars"] + new_sh_ars + withdrawn_ars
                event.amount_usd = src["work_usd"] + new_sh_usd
                event.shareholder_amount_usd = new_sh_usd
                event.notes = (event.notes or "") + " [parte accionaria recalculada al migrar]"
                event.save()
                deltas[inv.name] = event.amount_usd - old_usd
            if deltas:
                self.split_changes.append((payment, ref_date, deltas))

        self.stdout.write(f"Repartos con parte accionaria recalculada: {len(self.split_changes)}")
        for payment, ref_date, deltas in self.split_changes:
            detail = " · ".join(f"{name} {delta:+.2f}" for name, delta in sorted(deltas.items()))
            self.stdout.write(f"  cobro {payment.date} (ref. {ref_date}): {detail} USD")

    def _recompute_statuses(self, invoice_map, bill_map):
        for invoice in invoice_map.values():
            invoice.recompute_status()
        for bill in bill_map.values():
            bill.recompute_status()

    # ---------- report ----------

    def _report(self, investor_map, client_map, job_map, invoice_map, payment_map, purchase_map, bill_map):
        ars_balance = self.account_by_currency["ARS"].balance
        usd_balance = self.account_by_currency["USD"].balance
        cap_rows, total_capital = calc.cap_table()

        self.stdout.write(self.style.SUCCESS("\n=== Migración completa ==="))
        self.stdout.write(f"Caja ARS: {ars_balance}  ·  Caja USD: {usd_balance}")
        self.stdout.write(f"Capital total: {total_capital}")
        for row in cap_rows:
            self.stdout.write(f"  {row['investor'].name}: {row['capital_usd']} USD ({row['percentage']:.1f}%)")

        self.stdout.write(self.style.WARNING("\n=== Gaps conocidos (sin equivalente limpio en v2) ==="))
        if self.gap_unpaired_adjustments:
            for r in self.gap_unpaired_adjustments:
                self.stdout.write(
                    f"- CashMovement ADJUSTMENT sin pareja: {r['date']} {r['direction']} "
                    f"{r['currency']} {r['amount_original']} ('{r['notes']}') — no se pudo armar un "
                    "Transfer automático, revisar a mano."
                )
        if self.gap_expense_purchase_only:
            self.stdout.write(
                f"- {self.gap_expense_purchase_only} Expense en v1 estaban ligados a una Purchase "
                "directamente (sin PaymentObligation). v2 solo liga Expense a Bill, no a Purchase — "
                "ese vínculo se perdió (el gasto igual se migró, solo sin el link a la compra)."
            )
        if getattr(self, "gap_no_root_jobs", 0):
            self.stdout.write(
                f"- {self.gap_no_root_jobs} JobCollection raíz sin trabajos asociados (m2m vacío) — no se migraron."
            )
        self.stdout.write(
            "- Los usuarios de producción se migraron con su contraseña original (salvo los de "
            "SKIP_USERS en los datos privados)."
        )
        for gap in self.gaps:
            self.stdout.write(f"- {gap}")
