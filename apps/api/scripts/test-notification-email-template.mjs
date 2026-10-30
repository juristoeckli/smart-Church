import assert from "node:assert/strict";
import { renderNotificationEmail } from "../src/modules/notifications/email-templates.ts";

const withLink = renderNotificationEmail("New <announcement>", "Welcome &\nsee you soon.", "https://user:secret@church.example/settings?source=email#inbox", "de");
assert.equal(withLink.subject, "New <announcement>");
assert.match(withLink.text, /Welcome &\nsee you soon\./);
assert.match(withLink.text, /https:\/\/church\.example\//);
assert.match(withLink.html, /New &lt;announcement&gt;/);
assert.match(withLink.html, /Welcome &amp;<br>see you soon\./);
assert.match(withLink.html, /lang="de"/);
assert.match(withLink.html, /href="https:\/\/church\.example\/"/);
assert.match(withLink.html, /Smart Church öffnen/);
assert.doesNotMatch(withLink.html, /user:secret/);
assert.doesNotMatch(withLink.html, /javascript:/i);

const withoutLink = renderNotificationEmail("Reminder", "Your event starts tomorrow.", "javascript:alert(1)");
assert.doesNotMatch(withoutLink.html, /<a /);
assert.doesNotMatch(withoutLink.text, /Open Smart Church:/);
assert.match(renderNotificationEmail("Rappel", "Demain", undefined, "fr").html, /Cette notification a été envoyée par Smart Church/);
assert.match(renderNotificationEmail("Promemoria", "Domani", undefined, "it").text, /Questa notifica è stata inviata da Smart Church/);

console.log("Notification email template tests passed: escaped content and safe optional application link.");
