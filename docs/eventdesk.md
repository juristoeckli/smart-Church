# EventDesk

EventDesk is Smart-Church's event operations and rental module. A location can use it for customer jobs, equipment rentals, and crew planning whether or not it uses Smart-Church event workflows. Links to existing Smart-Church events and people are optional.

## Included in the first release

- Create jobs with customer, schedule, venue, notes, and an optional Smart-Church event link.
- Maintain customer records for companies and individuals, including contact details, billing address, notes, and active status; link customers to jobs.
- Set a default customer discount; new jobs snapshot that rate and quotes, invoices, and contracts show the discount as a separate line. Existing jobs and issued documents keep their saved prices.
- Create supplier rate cards with effective dates and category- or equipment-specific daily rates, then select a valid card when creating a job. Each booked rate is saved on the job so later card edits do not change its estimate or issued documents.
- Maintain separate supplier and venue directories; link a supplier to equipment and select a saved venue for a job.
- Maintain an equipment catalog with stock quantity and daily rental rates.
- Create reusable rental packages from catalog equipment, set a package discount rule, then add a package to a job in one step. EventDesk expands it into normal component bookings, applies the rule to the saved component rates, and checks availability for every item before saving the entire package.
- Create numbered quotes, rental contracts, delivery notes, regular invoices, and deposit invoices from a job plan; download branded PDFs, print them, or email them to a customer with the PDF attached.
- Track every email delivery attempt by recipient, subject, provider response, and time; a draft moves to sent only after the email provider accepts it. Quote decisions, contract signatures, delivery returns, invoice due dates, and full or partial payments are also tracked.
- Send an on-demand overdue payment reminder for an unpaid regular or deposit invoice. The reminder includes the current balance and the invoice PDF and is recorded in that document's delivery history. Scheduled automatic reminders are not included yet.
- Create credit notes against the unpaid balance of sent invoices or deposit invoices. Draft credits reserve balance; issued credits settle it and can be cancelled with the invoice balance recalculated.
- Export issued invoices, deposit invoices, credit notes, and payment records to a date-filtered CSV for accounting. The export includes document links, customer and job references, net, tax, gross, payments, status, and due dates.
- Edit draft document lines and tax before sending; set location-specific company contact details, tax ID, payment terms, and a footer for printed and emailed documents.
- Book equipment against a job. The API checks the maximum concurrent quantity for the booking dates and rejects overbooking.
- Track reserved, checked-out, and returned quantities. The Warehouse section provides printable job pick lists and barcode scanning for each unit checked out or returned.
- Schedule workshop maintenance for all or part of an equipment item's quantity; overlapping job bookings and maintenance windows share the same availability check.
- Request crew positions, optionally assign a person from the location's people directory, and prevent overlapping assignments.
- Maintain separate freelancer profiles with skills, contact details, and default rates. Record unavailable periods; EventDesk rejects assignments that overlap an unavailable period or another assigned job.
- Email a job request to an assigned freelancer, keep a delivery record, and track requested, invited, confirmed, or declined status. Confirmation is recorded by the EventDesk manager after the freelancer replies.
- Estimate the job total from booked equipment and crew rates.
- Restrict viewing and job, customer, inventory, crew, and finance management with EventDesk-specific access levels.

Every job and resource is scoped to the selected Smart-Church location. A job does not need a linked church event. Crew can be assigned to location contacts or separate EventDesk freelancer records. This first release runs inside Smart-Church; freelancers receive email requests and managers record their replies, with no separate freelancer portal or sign-in.

The SQL migrations are applied during normal Smart-Church startup. EventDesk is off by default for every location. A Server Administrator can enable it for a location with:

```sql
UPDATE departments
   SET enabled_modules = array_append(enabled_modules, 'eventdesk')
 WHERE id = '<location-uuid>'
   AND NOT ('eventdesk' = ANY(enabled_modules));
```

After enabling it, a site administrator can grant EventDesk access levels in People & access.

### Email delivery setup

EventDesk uses the shared [Resend email API](https://resend.com/docs/api-reference/emails/send-email). Configure `SMART_CHURCH_RESEND_API_KEY` and `SMART_CHURCH_EMAIL_FROM` on the Smart-Church server, using a verified sender address. The legacy `RESEND_API_KEY` and `EVENTDESK_EMAIL_FROM` names remain supported for existing deployments. Email delivery is optional; PDF download and browser printing work without a provider.

## Planned product areas

The document workflow is a first operational slice. These remaining areas are needed before EventDesk can cover a full rental office workflow:

- Logo and template customization, scheduled automatic reminders, and configurable tax/legal settings.
- Delivery notes, serial-number-level stock, barcode label generation, packing/casing, multi-warehouse stock, and transfers.
- Repair tickets with service history and recurring inspection reminders, sub-rentals, purchases, and multi-warehouse stock.
- Crew calendar views, self-service freelancer confirmations, import/export, and operational reporting.
