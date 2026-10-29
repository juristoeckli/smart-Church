# EventDesk

EventDesk is Smart-Church's event operations and rental module. A location can use it for customer jobs, equipment rentals, and crew planning whether or not it uses Smart-Church event workflows. Links to existing Smart-Church events and people are optional.

## Included in the first release

- Create jobs with customer, schedule, venue, notes, and an optional Smart-Church event link.
- Maintain an equipment catalog with stock quantity and daily rental rates.
- Book equipment against a job. The API checks the maximum concurrent quantity for the booking dates and rejects overbooking.
- Track equipment as reserved, checked out, returned, or cancelled.
- Request crew positions, optionally assign a person from the location's people directory, and prevent overlapping assignments.
- Estimate the job total from booked equipment and crew rates.
- Restrict viewing and job, inventory, and crew management with EventDesk-specific access levels.

Every job and resource is scoped to the selected Smart-Church location. A job does not need a linked church event. Crew assignments use the location's contacts. This first release runs inside Smart-Church and does not provide a separate freelancer portal or an independent sign-in.

The SQL migration is applied during normal Smart-Church startup. Site administrators can grant EventDesk access in People & access. Existing locations have the module enabled by the migration.

## Planned product areas

This release establishes the job, inventory, and crew workflows. Comparable rental platforms also include business documents and warehouse operations; those need separate delivery work:

- Customer and supplier CRM, contacts, rate cards, discounts, and reusable item bundles.
- Formal quotations, rental contracts, invoices, payment tracking, and accounting exports.
- Pick lists, delivery notes, serial number and barcode scanning, and warehouse check-in/out.
- Maintenance and workshop scheduling, sub-rentals, purchases, and multi-warehouse stock.
- Calendar and availability views, staff confirmations, and operational reporting.
