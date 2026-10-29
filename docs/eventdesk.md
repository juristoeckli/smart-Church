# EventDesk

EventDesk is Smart-Church's event operations and rental module. A location can use it for customer jobs, equipment rentals, and crew planning whether or not it uses Smart-Church event workflows. Links to existing Smart-Church events and people are optional.

## Included in the first release

- Create jobs with customer, schedule, venue, notes, and an optional Smart-Church event link.
- Maintain customer records for companies and individuals, including contact details, billing address, notes, and active status; link customers to jobs.
- Maintain separate supplier and venue directories; link a supplier to equipment and select a saved venue for a job.
- Maintain an equipment catalog with stock quantity and daily rental rates.
- Create numbered, print-ready quotes, rental contracts, delivery notes, and invoices from a job plan; track quote decisions, contract signatures, delivery returns, invoice due dates, and full or partial payments.
- Edit draft document lines and tax before marking them sent; set location-specific company contact details, tax ID, payment terms, and a footer for the print layout.
- Book equipment against a job. The API checks the maximum concurrent quantity for the booking dates and rejects overbooking.
- Track reserved, checked-out, and returned quantities. The Warehouse section provides printable job pick lists and barcode scanning for each unit checked out or returned.
- Schedule workshop maintenance for all or part of an equipment item's quantity; overlapping job bookings and maintenance windows share the same availability check.
- Request crew positions, optionally assign a person from the location's people directory, and prevent overlapping assignments.
- Estimate the job total from booked equipment and crew rates.
- Restrict viewing and job, customer, inventory, crew, and finance management with EventDesk-specific access levels.

Every job and resource is scoped to the selected Smart-Church location. A job does not need a linked church event. Crew assignments use the location's contacts. This first release runs inside Smart-Church and does not provide a separate freelancer portal or an independent sign-in.

The SQL migrations are applied during normal Smart-Church startup. EventDesk is off by default for every location. A Server Administrator can enable it for a location with:

```sql
UPDATE departments
   SET enabled_modules = array_append(enabled_modules, 'eventdesk')
 WHERE id = '<location-uuid>'
   AND NOT ('eventdesk' = ANY(enabled_modules));
```

After enabling it, a site administrator can grant EventDesk access levels in People & access.

## Planned product areas

The document workflow is a first operational slice. These remaining areas are needed before EventDesk can cover a full rental office workflow:

- Supplier rate cards, discounts, and reusable item bundles.
- Logo and template customization, email delivery through a configured mail provider, deposits, credit notes, reminders, accounting exports, and configurable tax/legal settings.
- Delivery notes, serial-number-level stock, barcode label generation, packing/casing, multi-warehouse stock, and transfers.
- Repair tickets with service history and recurring inspection reminders, sub-rentals, purchases, and multi-warehouse stock.
- Freelancer records, calendar and availability views, staff confirmations, import/export, and operational reporting.
