import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

const validPermissions = new Set(["people_view_private", "people_manage", "events_manage", "groups_manage", "resources_manage"]);
const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;
const signupLanguages = ["en", "de", "fr", "it"] as const;
type SignupLanguage = typeof signupLanguages[number];
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
function publicOrigin(request: FastifyRequest) {
  const configured = process.env.SMART_CHURCH_WEB_ORIGIN?.trim();
  if (configured) return new URL(configured).origin;
  const origin = request.headers.origin;
  if (origin) {
    try { return new URL(origin).origin; } catch { /* Derive from the request URL below. */ }
  }
  return `${request.protocol}://${request.headers.host}`;
}
function admin(request: FastifyRequest, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (request.authenticatedUser?.role === "server_admin") return true;
  reply.code(403).send({ error: "Server management access is required." });
  return false;
}
async function signupConfig(context: ModuleServerContext, departmentId: string) {
  if (!context.pool || !context.isDatabaseReady()) return null;
  const result = await context.pool.query<{ enabled: boolean; confirmation_delay_minutes: number }>(
    "SELECT enabled,confirmation_delay_minutes FROM department_self_signup_settings WHERE department_id=$1",
    [departmentId],
  );
  return result.rows[0] ?? { enabled: false, confirmation_delay_minutes: 11 };
}
function tokenIsValid(value: string) { return /^[A-Za-z0-9_-]{40,60}$/.test(value); }
function initialSignupEmail(language: SignupLanguage, url: string) {
  const copy: Record<SignupLanguage, { subject: string; text: string }> = {
    en: { subject: "Start your Smart-Church sign-up", text: `Use this secure link to complete your sign-up form. It expires in 7 days:\n\n${url}` },
    de: { subject: "Smart-Church-Registrierung starten", text: `Über diesen sicheren Link kannst du das Registrierungsformular ausfüllen. Der Link ist 7 Tage gültig:\n\n${url}` },
    fr: { subject: "Commencer votre inscription Smart-Church", text: `Utilisez ce lien sécurisé pour remplir le formulaire d’inscription. Il expire dans 7 jours :\n\n${url}` },
    it: { subject: "Inizia la registrazione a Smart-Church", text: `Usa questo link sicuro per completare il modulo di registrazione. Scade tra 7 giorni:\n\n${url}` },
  };
  return copy[language];
}
function confirmationSignupEmail(language: SignupLanguage, url: string) {
  const copy: Record<SignupLanguage, { subject: string; text: string }> = {
    en: { subject: "Confirm your Smart-Church sign-up", text: `Confirm your email address to submit your Smart-Church sign-up for review:\n\n${url}\n\nThis link expires in 24 hours.` },
    de: { subject: "Smart-Church-Registrierung bestätigen", text: `Bestätige deine E-Mail-Adresse, damit deine Smart-Church-Registrierung geprüft werden kann:\n\n${url}\n\nDieser Link ist 24 Stunden gültig.` },
    fr: { subject: "Confirmer votre inscription Smart-Church", text: `Confirmez votre adresse e-mail pour soumettre votre inscription Smart-Church à l’examen :\n\n${url}\n\nCe lien expire dans 24 heures.` },
    it: { subject: "Conferma la registrazione a Smart-Church", text: `Conferma il tuo indirizzo e-mail per inviare la registrazione a Smart-Church per la revisione:\n\n${url}\n\nQuesto link scade tra 24 ore.` },
  };
  return copy[language];
}
function loginDetailsEmail(language: SignupLanguage, loginUrl: string, username: string, temporaryPassword: string) {
  const copy: Record<SignupLanguage, { subject: string; text: string }> = {
    en: { subject: "Your Smart-Church account is ready", text: `Your account has been approved.\n\nSign in: ${loginUrl}\nUsername: ${username}\nTemporary password: ${temporaryPassword}\n\nYou will be asked to choose a new password when you first sign in.` },
    de: { subject: "Dein Smart-Church-Konto ist bereit", text: `Dein Konto wurde bestätigt.\n\nAnmelden: ${loginUrl}\nBenutzername: ${username}\nTemporäres Passwort: ${temporaryPassword}\n\nBei der ersten Anmeldung wirst du aufgefordert, ein neues Passwort festzulegen.` },
    fr: { subject: "Votre compte Smart-Church est prêt", text: `Votre compte a été approuvé.\n\nConnexion : ${loginUrl}\nNom d’utilisateur : ${username}\nMot de passe temporaire : ${temporaryPassword}\n\nVous devrez choisir un nouveau mot de passe lors de votre première connexion.` },
    it: { subject: "Il tuo account Smart-Church è pronto", text: `Il tuo account è stato approvato.\n\nAccedi: ${loginUrl}\nNome utente: ${username}\nPassword temporanea: ${temporaryPassword}\n\nAl primo accesso ti verrà chiesto di scegliere una nuova password.` },
  };
  return copy[language];
}
function profileSavedMessage(language: SignupLanguage) {
  const copy: Record<SignupLanguage, string> = {
    en: "Your details are saved. You will receive a confirmation email within 24 hours.",
    de: "Deine Angaben sind gespeichert. Du erhältst innerhalb von 24 Stunden eine Bestätigungs-E-Mail.",
    fr: "Vos informations sont enregistrées. Vous recevrez un e-mail de confirmation dans les 24 heures.",
    it: "I tuoi dati sono salvati. Riceverai un’e-mail di conferma entro 24 ore.",
  };
  return copy[language];
}
function expiredReviewEmail(language: SignupLanguage) {
  const copy: Record<SignupLanguage, { subject: string; text: string }> = {
    en: { subject: "Your Smart-Church sign-up request has expired", text: "Your Smart-Church sign-up request was not reviewed within 30 days, so the request and submitted profile details have been deleted. If you still want an account, please start a new sign-up." },
    de: { subject: "Deine Smart-Church-Registrierung ist abgelaufen", text: "Deine Smart-Church-Registrierung wurde nicht innerhalb von 30 Tagen geprüft. Deshalb wurden die Anfrage und deine übermittelten Angaben gelöscht. Wenn du weiterhin ein Konto möchtest, starte bitte eine neue Registrierung." },
    fr: { subject: "Votre demande d’inscription Smart-Church a expiré", text: "Votre demande d’inscription Smart-Church n’a pas été examinée dans les 30 jours. La demande et les informations fournies ont donc été supprimées. Si vous souhaitez toujours un compte, veuillez recommencer l’inscription." },
    it: { subject: "La richiesta di registrazione a Smart-Church è scaduta", text: "La tua richiesta di registrazione a Smart-Church non è stata esaminata entro 30 giorni, quindi la richiesta e i dati inviati sono stati eliminati. Se desideri ancora un account, avvia una nuova registrazione." },
  };
  return copy[language];
}

async function expireOldSignupRequests(pool: NonNullable<ModuleServerContext["pool"]>, isDatabaseReady: () => boolean, context: ModuleServerContext, log: FastifyInstance["log"], departmentId: string) {
  if (!isDatabaseReady()) return;
  await pool.query(
    `WITH stale AS (
       SELECT id FROM self_signup_requests
        WHERE department_id=$1 AND ((status IN ('awaiting_profile','expired') AND initial_requested_at <= now() - interval '7 days')
           OR (status='awaiting_confirmation' AND updated_at <= now() - interval '7 days')
        ) ORDER BY updated_at LIMIT 100
     )
     DELETE FROM self_signup_requests request USING stale WHERE request.id=stale.id`, [departmentId],
  );
  await pool.query(
    `WITH stale AS (
       SELECT id FROM self_signup_requests
        WHERE department_id=$1 AND status='pending_admin' AND email_confirmed_at <= now() - interval '30 days'
        ORDER BY email_confirmed_at LIMIT 100 FOR UPDATE SKIP LOCKED
     )
     UPDATE self_signup_requests request SET status='pending_expiry_notification',next_expiry_notification_at=now(),updated_at=now()
       FROM stale WHERE request.id=stale.id`, [departmentId],
  );
  const emailDepartmentId = departmentId;
  if (!await context.email.isConfigured(emailDepartmentId)) return;

  for (let sent = 0; sent < 20; sent += 1) {
    const client = await pool.connect();
    let candidate: { id: string; email: string; language: SignupLanguage; expiry_notification_attempts: number } | undefined;
    try {
      await client.query("BEGIN");
      const found = await client.query<{ id: string; email: string; language: SignupLanguage; expiry_notification_attempts: number }>(
        `SELECT id,email,language,expiry_notification_attempts FROM self_signup_requests
          WHERE department_id=$1 AND status='pending_expiry_notification' AND COALESCE(next_expiry_notification_at,now())<=now()
          ORDER BY next_expiry_notification_at NULLS FIRST LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [departmentId],
      );
      if (!found.rowCount) { await client.query("COMMIT"); break; }
      candidate = found.rows[0];
      await client.query("UPDATE self_signup_requests SET expiry_notification_attempts=expiry_notification_attempts+1,next_expiry_notification_at=now()+interval '15 minutes' WHERE id=$1", [candidate.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    if (!candidate) continue;

    try {
      await context.email.send({ recipientEmail: candidate.email, ...expiredReviewEmail(candidate.language) }, emailDepartmentId);
      await pool.query("DELETE FROM self_signup_requests WHERE id=$1 AND status='pending_expiry_notification'", [candidate.id]);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Could not send the expiry notification email.";
      await pool.query(
        `UPDATE self_signup_requests SET next_expiry_notification_at=now()+LEAST(expiry_notification_attempts*15,1440)*interval '1 minute',last_error=$2,updated_at=now()
          WHERE id=$1 AND status='pending_expiry_notification'`,
        [candidate.id, message],
      );
      log.warn({ err: error, requestId: candidate.id, attempts: candidate.expiry_notification_attempts + 1 }, "Could not send a self sign-up expiry notification.");
    }
  }
}

export async function emailModuleInstallationWritable(context: ModuleServerContext, departmentId = context.getDefaultDepartmentId()) {
  try {
    return await context.isDepartmentWritable(departmentId);
  } catch {
    return false;
  }
}

export function registerSelfSignupRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  let confirmationTimer: ReturnType<typeof setInterval> | undefined;

  async function requestDepartment(request: FastifyRequest, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
    const value = request.headers["x-department-id"];
    const id = typeof value === "string" ? value : context.getDefaultDepartmentId();
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) { reply.code(400).send({ error: "Choose a valid site." }); return null; }
    const exists = await pool?.query("SELECT 1 FROM departments WHERE id=$1 AND installation_id=(SELECT id FROM installations WHERE is_current=true)", [id]);
    if (!exists?.rowCount) { reply.code(404).send({ error: "The selected site was not found." }); return null; }
    return id;
  }

  const runSignupLifecycle = async () => {
    if (!pool || !isDatabaseReady()) return;
    const sites = await pool.query<{ id: string }>("SELECT id FROM departments WHERE installation_id=(SELECT id FROM installations WHERE is_current=true)");
    for (const site of sites.rows) {
      if (!await emailModuleInstallationWritable(context, site.id)) continue;
      await expireOldSignupRequests(pool, isDatabaseReady, context, app.log, site.id);
      await deliverDueConfirmations(site.id);
    }
  };

  async function deliverDueConfirmations(emailDepartmentId: string) {
    if (!pool || !isDatabaseReady() || !await context.email.isConfigured(emailDepartmentId)) return;
    for (let sent = 0; sent < 20; sent += 1) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query<{ id: string; email: string; language: SignupLanguage; confirmation_origin: string; confirmation_attempts: number }>(
          `SELECT request.id,request.email,request.language,request.confirmation_origin,request.confirmation_attempts
             FROM self_signup_requests request
             JOIN department_self_signup_settings settings ON settings.department_id=request.department_id AND settings.enabled=true
            WHERE request.department_id=$1 AND request.status='awaiting_confirmation' AND request.confirmation_sent_at IS NULL
              AND request.confirmation_available_at<=now() AND request.confirmation_expires_at>now()
              AND COALESCE(request.next_confirmation_attempt_at,now())<=now()
            ORDER BY request.confirmation_available_at LIMIT 1 FOR UPDATE OF request SKIP LOCKED`,
          [emailDepartmentId],
        );
        if (!found.rowCount) { await client.query("COMMIT"); break; }
        const request = found.rows[0];
        try {
          // The hash is not reversible. A fresh confirmation token is minted for every delivery attempt.
          const confirmationToken = newToken();
          const confirmationHash = tokenHash(confirmationToken);
          const confirmationUrl = new URL("/signup/confirm", request.confirmation_origin);
          confirmationUrl.searchParams.set("token", confirmationToken);
          confirmationUrl.searchParams.set("lang", request.language);
          confirmationUrl.searchParams.set("departmentId", emailDepartmentId);
          await client.query("UPDATE self_signup_requests SET confirmation_token_hash=$2,confirmation_expires_at=now()+interval '24 hours' WHERE id=$1", [request.id, confirmationHash]);
          await context.email.send({ recipientEmail: request.email, ...confirmationSignupEmail(request.language, confirmationUrl.toString()) }, emailDepartmentId);
          await client.query("UPDATE self_signup_requests SET confirmation_sent_at=now(),confirmation_attempts=confirmation_attempts+1,next_confirmation_attempt_at=NULL,last_error=NULL,updated_at=now() WHERE id=$1", [request.id]);
        } catch (error) {
          const attempts = request.confirmation_attempts + 1;
          const message = error instanceof Error ? error.message.slice(0, 500) : "Could not send the confirmation email.";
          if (attempts >= 8) {
            await client.query("UPDATE self_signup_requests SET status='expired',confirmation_token_hash=NULL,confirmation_attempts=$2,last_error=$3,updated_at=now() WHERE id=$1", [request.id, attempts, message]);
          } else {
            await client.query("UPDATE self_signup_requests SET confirmation_attempts=$2,next_confirmation_attempt_at=now()+LEAST($2*5,60)*interval '1 minute',last_error=$3,updated_at=now() WHERE id=$1", [request.id, attempts, message]);
          }
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    }
  }

  app.get("/api/modules/email-worker/self-signup/settings", async (request, reply) => {
    if (!admin(request, reply)) return reply;
    if (!pool || !isDatabaseReady()) return reply.code(503).send({ error: "The settings database is unavailable." });
    const departmentId = await requestDepartment(request, reply);
    if (!departmentId) return reply;
    const settings = await signupConfig(context, departmentId);
    return { enabled: settings?.enabled ?? false, confirmationDelayMinutes: settings?.confirmation_delay_minutes ?? 11 };
  });

  app.put<{ Body: { enabled: boolean; confirmationDelayMinutes: number } }>("/api/modules/email-worker/self-signup/settings", {
    schema: { body: { type: "object", additionalProperties: false, required: ["enabled", "confirmationDelayMinutes"], properties: { enabled: { type: "boolean" }, confirmationDelayMinutes: { type: "integer", minimum: 1, maximum: 1440 } } } },
  }, async (request, reply) => {
    if (!admin(request, reply)) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    if (!pool || !isDatabaseReady()) return reply.code(503).send({ error: "The settings database is unavailable." });
    const departmentId = await requestDepartment(request, reply);
    if (!departmentId) return reply;
    if (!await emailModuleInstallationWritable(context, departmentId)) return reply.code(423).send({ error: "Self sign-up settings are read-only while this site is in standby or fenced state." });
    if (request.body.enabled && !await context.email.isConfigured(departmentId)) return reply.code(400).send({ error: "Configure and enable email delivery for this site before enabling self sign-up." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) { await client.query("ROLLBACK"); return reply.code(423).send({ error: "Self sign-up settings became read-only while this site was being promoted or fenced." }); }
      await client.query(
        `INSERT INTO department_self_signup_settings (department_id,enabled,confirmation_delay_minutes,updated_at)
         VALUES ($1,$2,$3,now()) ON CONFLICT (department_id) DO UPDATE SET enabled=EXCLUDED.enabled,confirmation_delay_minutes=EXCLUDED.confirmation_delay_minutes,updated_at=now()`,
        [departmentId, request.body.enabled, request.body.confirmationDelayMinutes],
      );
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return { enabled: request.body.enabled, confirmationDelayMinutes: request.body.confirmationDelayMinutes };
  });

  app.post<{ Body: { email: string; departmentId: string; language?: SignupLanguage } }>("/api/public/self-signup/request", {
    schema: { body: { type: "object", additionalProperties: false, required: ["email", "departmentId"], properties: { email: { type: "string", minLength: 3, maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" }, departmentId: { type: "string", format: "uuid" }, language: { type: "string", enum: [...signupLanguages] } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return reply.code(503).send({ error: "Sign-up is temporarily unavailable." });
    const departmentId = request.body.departmentId;
    const site = await pool.query("SELECT 1 FROM departments WHERE id=$1 AND installation_id=(SELECT id FROM installations WHERE is_current=true)", [departmentId]);
    if (!site.rowCount) return reply.code(404).send({ error: "The selected site was not found." });
    if (!await emailModuleInstallationWritable(context, departmentId)) return reply.code(423).send({ error: "Self sign-up is temporarily unavailable while this site is in standby or fenced state." });
    const config = await signupConfig(context, departmentId);
    if (!config?.enabled || !await context.email.isConfigured(departmentId)) return reply.code(404).send({ error: "Self sign-up is currently unavailable for this site." });
    const email = request.body.email.trim().toLowerCase();
    const language = request.body.language ?? "en";
    const genericMessages: Record<SignupLanguage, string> = {
      en: "If sign-up is available for this address, an email will arrive within 24 hours.",
      de: "Falls eine Registrierung mit dieser Adresse möglich ist, erhältst du innerhalb von 24 Stunden eine E-Mail.",
      fr: "Si l’inscription est possible pour cette adresse, vous recevrez un e-mail dans les 24 heures.",
      it: "Se la registrazione è disponibile per questo indirizzo, riceverai un’e-mail entro 24 ore.",
    };
    const generic = { accepted: true, message: genericMessages[language] };
    const client = await pool.connect();
    let rawToken = "";
    let requestId = "";
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) { await client.query("ROLLBACK"); return reply.code(423).send({ error: "Self sign-up became unavailable while this site was being promoted or fenced." }); }
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${departmentId}:${email}`]);
      const existingAccount = await client.query("SELECT 1 FROM app_users WHERE lower(email)=$1", [email]);
      if (existingAccount.rowCount) { await client.query("COMMIT"); return generic; }
      const existing = await client.query<{ id: string; status: string; initial_requested_at: Date | string; initial_expires_at: Date | string | null }>("SELECT id,status,initial_requested_at,initial_expires_at FROM self_signup_requests WHERE department_id=$1 AND lower(email)=$2 FOR UPDATE", [departmentId, email]);
      const row = existing.rows[0];
      const recent = row && Date.now() - new Date(row.initial_requested_at).getTime() < 5 * 60_000;
      if (row && (recent || ["pending_admin", "pending_expiry_notification", "approved_delivery_failed", "approved"].includes(row.status))) { await client.query("COMMIT"); return generic; }
      rawToken = newToken();
      requestId = row?.id ?? randomUUID();
      if (row) {
        await client.query(
          `UPDATE self_signup_requests SET status='awaiting_profile',language=$3,first_name='',last_name='',phone='',street='',street_number='',postal_code='',city='',username='',initial_token_hash=$2,initial_expires_at=now()+interval '7 days',initial_requested_at=now(),confirmation_token_hash=NULL,confirmation_available_at=NULL,confirmation_expires_at=NULL,confirmation_sent_at=NULL,email_confirmed_at=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND department_id=$4`,
          [requestId, tokenHash(rawToken), language, departmentId],
        );
      } else {
        await client.query("INSERT INTO self_signup_requests (id,email,department_id,status,language,initial_token_hash,initial_expires_at,initial_requested_at) VALUES ($1,$2,$3,'awaiting_profile',$4,$5,now()+interval '7 days',now())", [requestId, email, departmentId, language, tokenHash(rawToken)]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code !== "23505") throw error;
      return generic;
    } finally { client.release(); }
    try {
      const url = new URL("/signup", publicOrigin(request));
      url.searchParams.set("token", rawToken);
      url.searchParams.set("lang", language);
      url.searchParams.set("departmentId", departmentId);
      await context.email.send({ recipientEmail: email, ...initialSignupEmail(language, url.toString()) }, departmentId);
    } catch (error) {
      request.log.warn({ err: error }, "Could not send a self sign-up start link.");
      await pool.query("UPDATE self_signup_requests SET status='expired',initial_token_hash=NULL,last_error=$2,updated_at=now() WHERE id=$1 AND status='awaiting_profile'", [requestId, error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed."]);
    }
    return generic;
  });

  app.get<{ Params: { token: string } }>("/api/public/self-signup/form/:token", { schema: { params: { type: "object", required: ["token"], properties: { token: { type: "string", minLength: 40, maxLength: 60 } } } } }, async (request, reply) => {
    if (!pool || !isDatabaseReady() || !tokenIsValid(request.params.token)) return reply.code(404).send({ error: "This sign-up link is invalid or expired." });
    const result = await pool.query<{ email: string; language: SignupLanguage; department_id: string }>(`SELECT request.email,request.language,request.department_id FROM self_signup_requests request JOIN department_self_signup_settings settings ON settings.department_id=request.department_id AND settings.enabled=true WHERE request.status='awaiting_profile' AND request.initial_token_hash=$1 AND request.initial_expires_at>now()`, [tokenHash(request.params.token)]);
    if (!result.rows[0]) return reply.code(404).send({ error: "This sign-up link is invalid or expired." });
    return { email: result.rows[0].email, language: result.rows[0].language, departmentId: result.rows[0].department_id };
  });

  app.post<{ Body: { token: string; language?: SignupLanguage; firstName: string; lastName: string; phone?: string; street?: string; streetNumber?: string; postalCode?: string; city?: string } }>("/api/public/self-signup/profile", {
    schema: { body: { type: "object", additionalProperties: false, required: ["token", "firstName", "lastName"], properties: { token: { type: "string", minLength: 40, maxLength: 60 }, language: { type: "string", enum: [...signupLanguages] }, firstName: { type: "string", minLength: 1, maxLength: 80 }, lastName: { type: "string", minLength: 1, maxLength: 80 }, phone: { type: "string", maxLength: 32 }, street: { type: "string", maxLength: 160 }, streetNumber: { type: "string", maxLength: 24 }, postalCode: { type: "string", maxLength: 20 }, city: { type: "string", maxLength: 100 } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady() || !tokenIsValid(request.body.token)) return reply.code(404).send({ error: "This sign-up link is invalid or expired." });
    const signup = await pool.query<{ department_id: string }>("SELECT department_id FROM self_signup_requests WHERE initial_token_hash=$1 AND status='awaiting_profile' AND initial_expires_at>now()", [tokenHash(request.body.token)]);
    if (!signup.rows[0]) return reply.code(404).send({ error: "This sign-up link is invalid or expired." });
    const departmentId = signup.rows[0].department_id;
    if (!await emailModuleInstallationWritable(context, departmentId)) return reply.code(423).send({ error: "Self sign-up is temporarily unavailable while this site is in standby or fenced state." });
    const config = await signupConfig(context, departmentId);
    if (!config?.enabled) return reply.code(404).send({ error: "Self sign-up is currently unavailable for this site." });
    const client = await pool.connect();
    let submitted: { email: string; language: SignupLanguage } | undefined;
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) { await client.query("ROLLBACK"); return reply.code(423).send({ error: "Self sign-up became unavailable while this site was being promoted or fenced." }); }
      const email = await client.query<{ email: string; language: SignupLanguage }>(
      `UPDATE self_signup_requests SET language=COALESCE($2::text,language),first_name=$3,last_name=$4,phone=$5,street=$6,street_number=$7,postal_code=$8,city=$9,
              status='awaiting_confirmation',initial_token_hash=NULL,initial_expires_at=NULL,confirmation_token_hash=$10,
              confirmation_available_at=now()+($11*interval '1 minute'),confirmation_expires_at=now()+($11*interval '1 minute')+interval '24 hours',confirmation_origin=$12,
              confirmation_attempts=0,next_confirmation_attempt_at=NULL,confirmation_sent_at=NULL,last_error=NULL,updated_at=now()
        WHERE department_id=$13 AND initial_token_hash=$1 AND status='awaiting_profile' AND initial_expires_at>now() RETURNING email,language`,
      [tokenHash(request.body.token), request.body.language ?? null, request.body.firstName.trim(), request.body.lastName.trim(), request.body.phone?.trim() ?? "", request.body.street?.trim() ?? "", request.body.streetNumber?.trim() ?? "", request.body.postalCode?.trim() ?? "", request.body.city?.trim() ?? "", tokenHash(newToken()), config.confirmation_delay_minutes, publicOrigin(request), departmentId],
      );
      if (!email.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "This sign-up link is invalid or expired." }); }
      submitted = email.rows[0];
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return { submitted: true, message: profileSavedMessage(submitted!.language) };
  });

  app.post<{ Body: { token: string } }>("/api/public/self-signup/confirm", { schema: { body: { type: "object", additionalProperties: false, required: ["token"], properties: { token: { type: "string", minLength: 40, maxLength: 60 } } } } }, async (request, reply) => {
    if (!pool || !isDatabaseReady() || !tokenIsValid(request.body.token)) return reply.code(404).send({ error: "This confirmation link is invalid or expired." });
    const signup = await pool.query<{ department_id: string }>("SELECT department_id FROM self_signup_requests WHERE confirmation_token_hash=$1 AND status='awaiting_confirmation' AND confirmation_sent_at IS NOT NULL AND confirmation_expires_at>now()", [tokenHash(request.body.token)]);
    if (!signup.rows[0]) return reply.code(404).send({ error: "This confirmation link is invalid or expired." });
    const departmentId = signup.rows[0].department_id;
    if (!await emailModuleInstallationWritable(context, departmentId)) return reply.code(423).send({ error: "Self sign-up is temporarily unavailable while this site is in standby or fenced state." });
    const config = await signupConfig(context, departmentId);
    if (!config?.enabled) return reply.code(404).send({ error: "Self sign-up is currently unavailable for this site." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) { await client.query("ROLLBACK"); return reply.code(423).send({ error: "Self sign-up became unavailable while this site was being promoted or fenced." }); }
      const result = await client.query(
        `UPDATE self_signup_requests SET status='pending_admin',confirmation_token_hash=NULL,email_confirmed_at=now(),updated_at=now()
          WHERE department_id=$2 AND confirmation_token_hash=$1 AND status='awaiting_confirmation' AND confirmation_sent_at IS NOT NULL AND confirmation_expires_at>now() RETURNING id`,
        [tokenHash(request.body.token), departmentId],
      );
      if (!result.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "This confirmation link is invalid or expired." }); }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return { confirmed: true, message: "Your email is confirmed. A server administrator will review your sign-up." };
  });

  app.get("/api/modules/email-worker/self-signup/requests", async (request, reply) => {
    if (!admin(request, reply)) return reply;
    if (!pool || !isDatabaseReady()) return reply.code(503).send({ error: "The sign-up queue is unavailable." });
    const departmentId = await requestDepartment(request, reply);
    if (!departmentId) return reply;
    const [requests, departments] = await Promise.all([
      pool.query("SELECT id,email,first_name AS \"firstName\",last_name AS \"lastName\",phone,street,street_number AS \"streetNumber\",postal_code AS \"postalCode\",city,username,status,created_at AS \"createdAt\",last_error AS \"lastError\" FROM self_signup_requests WHERE department_id=$1 AND status IN ('pending_admin','approved_delivery_failed') ORDER BY created_at", [departmentId]),
      pool.query("SELECT id,name,enabled_modules AS \"enabledModules\" FROM departments WHERE id=$1", [departmentId]),
    ]);
    return { requests: requests.rows, departments: departments.rows };
  });

  app.put<{ Params: { id: string }; Body: { action: "approve" | "deny" | "retry_login"; username?: string; firstName?: string; lastName?: string; phone?: string; street?: string; streetNumber?: string; postalCode?: string; city?: string; role?: "member" | "site_admin"; permissions?: string[]; videoPermissions?: string[]; presenterPermissions?: string[]; modulePermissions?: Record<string, string[]> } }>("/api/modules/email-worker/self-signup/requests/:id", {
    schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["action"], properties: { action: { type: "string", enum: ["approve", "deny", "retry_login"] }, username: { type: "string", minLength: 3, maxLength: 32, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$" }, firstName: { type: "string", minLength: 1, maxLength: 80 }, lastName: { type: "string", minLength: 1, maxLength: 80 }, phone: { type: "string", maxLength: 32 }, street: { type: "string", maxLength: 160 }, streetNumber: { type: "string", maxLength: 24 }, postalCode: { type: "string", maxLength: 20 }, city: { type: "string", maxLength: 100 }, role: { type: "string", enum: ["member", "site_admin"] }, permissions: { type: "array", uniqueItems: true, items: { type: "string", enum: [...validPermissions] } }, videoPermissions: { type: "array", uniqueItems: true, items: { type: "string", enum: ["video_basic", "streaming_operator", "stream_admin", "routing_user", "routing_admin"] } }, presenterPermissions: { type: "array", uniqueItems: true, items: { type: "string", enum: ["editor", "operator", "admin"] } }, modulePermissions: { type: "object", maxProperties: 50, additionalProperties: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 80 } } } } },
    },
  }, async (request, reply) => {
    if (!admin(request, reply)) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    if (!pool || !isDatabaseReady()) return reply.code(503).send({ error: "The sign-up queue is unavailable." });
    const id = request.params.id;
    const selectedDepartmentId = await requestDepartment(request, reply);
    if (!selectedDepartmentId) return reply;
    if (!await emailModuleInstallationWritable(context, selectedDepartmentId)) return reply.code(423).send({ error: "Self sign-up requests are read-only while this site is in standby or fenced state." });
    if (request.body.action === "deny") {
      const result = await pool.query("UPDATE self_signup_requests SET status='denied',confirmation_token_hash=NULL,initial_token_hash=NULL,reviewed_at=now(),reviewed_by=$3,updated_at=now() WHERE id=$1 AND department_id=$2 AND status='pending_admin' RETURNING id", [id, selectedDepartmentId, request.authenticatedUser!.id]);
      if (!result.rowCount) return reply.code(409).send({ error: "This request is no longer awaiting review." });
      return { denied: true };
    }
    let userId: string;
    let temporaryPassword = "";
    if (request.body.action === "retry_login") {
      const existing = await pool.query<{ account_user_id: string; email: string; language: SignupLanguage; department_id: string }>(`SELECT request.account_user_id,request.email,request.language,request.department_id
        FROM self_signup_requests request WHERE request.id=$1 AND request.department_id=$2 AND request.status='approved_delivery_failed'`, [id, selectedDepartmentId]);
      if (!existing.rows[0]?.account_user_id) return reply.code(409).send({ error: "This request is not awaiting a login email retry." });
      userId = existing.rows[0].account_user_id;
      temporaryPassword = randomBytes(24).toString("base64url");
      await pool.query("UPDATE app_users SET password_hash=$2,must_change_password=true WHERE id=$1", [userId, hashPassword(temporaryPassword)]);
      const account = await pool.query<{ username: string }>("SELECT username FROM app_users WHERE id=$1", [userId]);
      try { await sendLoginDetails(context, request, existing.rows[0].email, account.rows[0].username, temporaryPassword, existing.rows[0].language, existing.rows[0].department_id); }
      catch (error) { return reply.code(502).send({ error: error instanceof Error ? `Login email could not be sent: ${error.message}` : "Login email could not be sent." }); }
      await pool.query("UPDATE self_signup_requests SET status='approved',last_error=NULL,updated_at=now() WHERE id=$1", [id]);
      return { approved: true, resent: true };
    }
    const body = request.body;
    if (!body.username || !usernamePattern.test(body.username) || !body.firstName?.trim() || !body.lastName?.trim() || !body.role) return reply.code(400).send({ error: "Enter the applicant details, username, and access role." });
    const departmentId = selectedDepartmentId;
    if (!await context.isDepartmentWritable(departmentId)) return reply.code(423).send({ error: "This site is read-only while it is in redundancy standby or fenced state." });
    const permissions = body.permissions ?? [];
    if (permissions.some((permission) => !validPermissions.has(permission))) return reply.code(400).send({ error: "One or more location permissions are invalid." });
    const client = await pool.connect();
    let signupEmail = "";
    let signupLanguage: SignupLanguage = "en";
    try {
      await client.query("BEGIN");
      const signup = await client.query<{ email: string; language: SignupLanguage; status: string }>("SELECT email,language,status FROM self_signup_requests WHERE id=$1 AND department_id=$2 FOR UPDATE", [id, departmentId]);
      if (!signup.rows[0] || signup.rows[0].status !== "pending_admin") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This request is no longer awaiting review." }); }
      signupEmail = signup.rows[0].email;
      signupLanguage = signup.rows[0].language;
      const department = await client.query<{ enabled_modules: string[] }>("SELECT enabled_modules FROM departments WHERE id=$1", [departmentId]);
      if (!department.rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Choose an existing site." }); }
      if (!await context.lockDepartmentForWrite(client, departmentId)) { await client.query("ROLLBACK"); return reply.code(423).send({ error: "This site became read-only while it was in redundancy standby or fenced state." }); }
      const permittedModuleIds = new Set(department.rows[0].enabled_modules ?? []);
      if (Object.keys(body.modulePermissions ?? {}).some((moduleId) => !permittedModuleIds.has(moduleId))) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Remove rights for modules that are not enabled at this site." }); }
      const duplicate = await client.query("SELECT 1 FROM app_users WHERE lower(username)=lower($1) OR lower(email)=lower($2)", [body.username, signupEmail]);
      if (duplicate.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "An account already uses this email address or username." }); }
      userId = randomUUID();
      temporaryPassword = randomBytes(24).toString("base64url");
      const fullName = `${body.firstName.trim()} ${body.lastName.trim()}`;
      await client.query(
        `INSERT INTO app_users (id,email,username,display_name,password_hash,role,street,street_number,postal_code,city,must_change_password)
         VALUES ($1,$2,$3,$4,$5,'user',$6,$7,$8,$9,true)`,
        [userId, signupEmail, body.username.trim().toLowerCase(), fullName, hashPassword(temporaryPassword), body.street?.trim() || null, body.streetNumber?.trim() || null, body.postalCode?.trim() || null, body.city?.trim() || null],
      );
      if (body.phone?.trim()) await client.query("INSERT INTO user_phone_numbers (user_id,position,label,number) VALUES ($1,0,'mobile',$2)", [userId, body.phone.trim()]);
      const videoPermissions = body.role === "member" ? body.videoPermissions ?? [] : [];
      const presenterPermissions = body.role === "member" ? body.presenterPermissions ?? [] : [];
      const modulePermissions = body.role === "member" ? { ...(body.modulePermissions ?? {}), ...(videoPermissions.length ? { "video-steffisburg": videoPermissions } : {}), ...(presenterPermissions.length ? { presenter: presenterPermissions } : {}) } : {};
      await client.query("INSERT INTO department_memberships (user_id,department_id,role,permissions,video_permissions,presenter_permissions,module_permissions) VALUES ($1,$2,$3,$4,$5,$6,$7)", [userId, departmentId, body.role, body.role === "site_admin" ? [] : permissions, videoPermissions, presenterPermissions, JSON.stringify(modulePermissions)]);
      await client.query("UPDATE self_signup_requests SET username=$2,status='approved_delivery_failed',account_user_id=$3,reviewed_at=now(),reviewed_by=$4,last_error=NULL,updated_at=now() WHERE id=$1", [id, body.username.trim().toLowerCase(), userId, request.authenticatedUser!.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "That username or email address is already in use." });
      throw error;
    } finally { client.release(); }
    try { await sendLoginDetails(context, request, signupEmail, body.username!.trim().toLowerCase(), temporaryPassword, signupLanguage, departmentId); }
    catch (error) { return reply.code(502).send({ error: error instanceof Error ? `Account was created, but the login email could not be sent. Retry the email from the review list. ${error.message}` : "Account was created, but the login email could not be sent. Retry the email from the review list." }); }
    await pool.query("UPDATE self_signup_requests SET status='approved',last_error=NULL,updated_at=now() WHERE id=$1", [id]);
    return { approved: true };
  });

  app.addHook("onReady", async () => {
    await runSignupLifecycle().catch((error) => app.log.error({ err: error }, "Could not process self sign-up lifecycle."));
    confirmationTimer = setInterval(() => { void runSignupLifecycle().catch((error) => app.log.error({ err: error }, "Could not process self sign-up lifecycle.")); }, 15_000);
    confirmationTimer.unref?.();
  });
  app.addHook("onClose", async () => { if (confirmationTimer) clearInterval(confirmationTimer); });
}

async function sendLoginDetails(context: ModuleServerContext, request: FastifyRequest, email: string, username: string, temporaryPassword: string, language: SignupLanguage, departmentId = context.getDefaultDepartmentId()) {
  const login = new URL("/", publicOrigin(request));
  login.searchParams.set("lang", language);
  const loginUrl = login.toString();
  await context.email.send({ recipientEmail: email, ...loginDetailsEmail(language, loginUrl, username, temporaryPassword) }, departmentId);
}
