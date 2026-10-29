# EventDesk

EventDesk is Smart-Church's event operations and rental module. A location can use it for customer jobs, equipment rentals, and crew planning whether or not it uses Smart-Church event workflows. Links to existing Smart-Church events and people are optional.

## Included in the first release

- Create jobs with customer, schedule, venue, notes, and an optional Smart-Church event link.
- Maintain customer records for companies and individuals, including contact details, billing address, notes, and active status; link customers to jobs.
- Set a default customer discount; new jobs snapshot that rate and quotes, invoices, and contracts show the discount as a separate line. Existing jobs and issued documents keep their saved prices.
- Create supplier rate cards with effective dates and category- or equipment-specific daily rates, then select a valid card when creating a job. Each booked rate is saved on the job so later card edits do not change its estimate or issued documents.
- Maintain separate supplier and venue directories; link a supplier to equipment and select a saved venue for a job.
- Maintain an equipment catalog with stock quantity and daily rental rates.
- Register individual serialised units alongside count-based stock, assign them to warehouses, generate printable barcode labels, and scan their barcodes during checkout and return.
- Define reusable cases with required equipment and quantities, check scanned contents for missing or extra items, and record each contents check for audit.
- Track stock quantities per warehouse, choose a warehouse when reserving equipment, and record transfers through dispatch and receipt with timestamps and responsible users.
- Create reusable rental packages from catalog equipment, set a package discount rule, then add a package to a job in one step. EventDesk expands it into normal component bookings, applies the rule to the saved component rates, and checks availability for every item before saving the entire package.
- Create numbered quotes, rental contracts, delivery notes, regular invoices, and deposit invoices from a job plan; download branded PDFs, print them, or email them to a customer with the PDF attached.
- Track every email delivery attempt by recipient, subject, provider response, and time; a draft moves to sent only after the email provider accepts it. Quote decisions, contract signatures, delivery returns, invoice due dates, and full or partial payments are also tracked.
- Send manual or scheduled overdue payment reminders for regular and deposit invoices. Locations configure the delay schedule and maximum attempts; finance users can preview the live balance and pause reminders per invoice. Payments, draft or issued credits, cancellations, and settlement are checked before scheduled delivery, and every attempt and provider result is recorded.
- Create credit notes against the unpaid balance of sent invoices or deposit invoices. Draft credits reserve balance; issued credits settle it and can be cancelled with the invoice balance recalculated.
- Export issued invoices, deposit invoices, credit notes, and payment records to a date-filtered CSV for accounting. The export includes document links, customer and job references, net, tax, gross, payments, status, and due dates.
- Edit draft document lines and tax before sending; set location-specific company contact details, tax ID, payment terms, and a footer for printed and emailed documents.
- Upload a location logo, preview reusable templates for every document type, and configure tax rates with legal disclosures. New documents save branding, logo, and tax-profile snapshots so later settings changes do not rewrite existing documents.
- Book equipment against a job. The API checks the maximum concurrent quantity for the booking dates and rejects overbooking.
- Track reserved, checked-out, and returned quantities. The Warehouse section provides printable job pick lists and barcode scanning for each unit checked out or returned.
- Schedule workshop maintenance for all or part of an equipment item's quantity; overlapping job bookings and maintenance windows share the same availability check.
- Open repair and inspection tickets for catalog items or individual serialised units, assign a staff owner, record diagnosis, parts, work, labour and parts costs, and attach service documents. Active tickets remove stock from availability. Recurring inspection schedules generate tickets when due, show overdue dates, and can email the assigned schedule owner a reminder during the week before the due date.
- Create supplier purchase requests linked to a job or general stock, route orders through finance approval, track line-level ordered/received/cancelled quantities and delivery dates, and receive catalog equipment into the default warehouse. Attach supplier documents and review the status audit trail.
- Reserve external equipment from a supplier against a job and catalog item, allocate it to bookings when owned warehouse stock is short, and track dispatch, partial returns, late supplier charges, and return notes. Sub-rental and purchase commitments contribute to the job's projected supply cost without silently increasing owned stock.
- Open repair and inspection tickets for catalog items or individual serialised units, assign a staff owner, track diagnosis, parts, work, labour and parts costs, and attach service documents. Open tickets remove stock from availability; completing or cancelling a ticket releases its maintenance hold. Recurring inspection schedules generate service tickets when due and keep a service history.
- Request crew positions, optionally assign a person from the location's people directory, and prevent overlapping assignments.
- Maintain separate freelancer profiles with skills, contact details, and default rates. Record unavailable periods; EventDesk rejects assignments that overlap an unavailable period or another assigned job.
- Email a job request to an assigned freelancer, keep a delivery record, and track requested, invited, confirmed, or declined status. Confirmation is recorded by the EventDesk manager after the freelancer replies.
- Estimate the job total from booked equipment and crew rates.
- Restrict viewing and job, customer, inventory, crew, and finance management with EventDesk-specific access levels.

Every job and resource is scoped to the selected Smart-Church location. A job does not need a linked church event. Crew can be assigned to location contacts or separate EventDesk freelancer records. This first release runs inside Smart-Church; freelancers receive email requests and managers record their replies, with no separate freelancer portal or sign-in.

The SQL migrations are applied during normal Smart-Church startup. EventDesk is optional and off by default. A Server Administrator activates optional modules for the whole installation in Settings → Modules. After activation, site administrators can grant EventDesk access levels separately at each location in People & access.

### Email delivery setup

EventDesk uses the shared [Resend email API](https://resend.com/docs/api-reference/emails/send-email). Configure `SMART_CHURCH_RESEND_API_KEY` and `SMART_CHURCH_EMAIL_FROM` on the Smart-Church server, using a verified sender address. The legacy `RESEND_API_KEY` and `EVENTDESK_EMAIL_FROM` names remain supported for existing deployments. Email delivery is optional; PDF download and browser printing work without a provider.

## Planned product areas

These remaining areas are needed before EventDesk can cover a full rental office workflow:

- Crew calendar views, self-service freelancer confirmations, import/export, and operational reporting.
