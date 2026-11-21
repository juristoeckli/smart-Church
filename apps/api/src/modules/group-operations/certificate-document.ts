export type Certificate = {
  id: string; name: string; personName: string; groupName: string; siteName: string;
  issuedAt: string; validUntil: string | null; documentText: string;
};

const extraCharacters = "€\u0000‚ƒ„…†‡ˆ‰Š‹Œ\u0000Ž\u0000\u0000‘’“”•–—˜™š›œ\u0000žŸ";
function winAnsi(value: string) {
  const bytes: number[] = [];
  for (const character of value.normalize("NFC")) {
    const ordinal = character.codePointAt(0)!;
    if ((ordinal >= 32 && ordinal <= 126) || (ordinal >= 160 && ordinal <= 255)) bytes.push(ordinal);
    else if (character !== "\u0000" && extraCharacters.includes(character)) bytes.push(128 + extraCharacters.indexOf(character));
    else return null;
  }
  return Buffer.from(bytes).toString("hex");
}

function certificateParts(row: Certificate) {
  const fields = {
    recipient: row.personName, certificate: row.name, group: row.groupName, location: row.siteName,
    issuedOn: row.issuedAt, validUntil: row.validUntil ?? "No expiry",
  };
  const body = row.documentText.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => (
    Object.hasOwn(fields, key) ? fields[key as keyof typeof fields] : match
  ));
  return { fields, body, details: [
    "Group: " + row.groupName,
    "Issued: " + row.issuedAt,
    ...(row.validUntil ? ["Valid through: " + row.validUntil] : []),
    "Certificate reference: " + row.id,
  ] };
}

export function validCertificateTemplate(value: string) {
  const names = new Set(["recipient", "certificate", "group", "location", "issuedOn", "validUntil"]);
  return [...value.matchAll(/\{\{\s*(.*?)\s*\}\}/g)].every(([, name]) => names.has(name.trim()));
}

function estimatedHelveticaWidth(character: string) {
  if (/^[W@%Œ]$/.test(character)) return 1.08;
  if (/^[mwMœ]$/.test(character)) return 0.88;
  if (/^[A-ZÀ-Þ]$/.test(character)) return 0.79;
  if (/^[a-zà-ÿ]$/.test(character)) return 0.68;
  if (/^[0-9]$/.test(character)) return 0.58;
  if (/^[ .,:;!|]$/.test(character)) return 0.34;
  return 0.9;
}

function wrap(value: string, fontSize: number) {
  const maximumUnits = 482 / fontSize;
  return value.normalize("NFC").replace(/\r\n?/g, "\n").split("\n").flatMap((paragraph) => {
    const lines: string[] = [];
    const text = Array.from(paragraph.trim().replace(/[^\S\n]+/g, " "));
    let start = 0;
    while (start < text.length) {
      let end = start;
      let width = 0;
      let space = -1;
      while (end < text.length && width + estimatedHelveticaWidth(text[end]) <= maximumUnits) {
        if (text[end] === " ") space = end;
        width += estimatedHelveticaWidth(text[end]);
        end++;
      }
      const split = end < text.length && space > start ? space : end;
      lines.push(text.slice(start, split).join(""));
      start = text[split] === " " ? split + 1 : split;
    }
    return lines.length ? lines : [""];
  });
}

function pdfBuffer(commands: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = output.length;
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return String(offset).padStart(10, "0") + " 00000 n \n";
  });
  const xref = output.length;
  return Buffer.from(output + `xref\n0 6\n0000000000 65535 f \n${offsets.join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, "ascii");
}

export function renderCertificatePdf(row: Certificate) {
  const { fields, body, details } = certificateParts(row);
  const sections = [
    { text: fields.location, size: 14, after: 22 },
    { text: fields.certificate, size: 25, after: 18 },
    { text: fields.recipient, size: 19, after: 20 },
    ...(body ? [{ text: body, size: 11, after: 22 }] : []),
    { text: details.join("\n"), size: 11, after: 0 },
  ];
  const commands = ["0.17 0.31 0.40 RG", "1.4 w", "35 35 542 722 re S", "0.5 w", "64 720 m 138 720 l S", "0.14 0.20 0.25 rg"];
  let baseline = 704;
  for (const { text, size, after } of sections) {
    for (const line of wrap(text, size)) {
      const encoded = winAnsi(line);
      if (encoded === null || baseline < 62) return null;
      commands.push(`BT /F1 ${size} Tf 64 ${baseline} Td <${encoded}> Tj ET`);
      baseline -= Math.ceil(size * 1.35);
    }
    baseline -= after;
  }
  return pdfBuffer(commands.join("\n"));
}

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
}[character] ?? ""));

export function renderCertificatePrintView(row: Certificate) {
  const { fields, body, details } = certificateParts(row);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'">
<title>${escapeHtml(fields.certificate)}</title>
<style>
body{font:16px/1.55 system-ui,sans-serif;color:#233746;margin:0;padding:2rem;background:#fff}
main{max-width:680px;margin:auto;border:2px solid #35586b;padding:2rem;overflow-wrap:anywhere}
h1{font-size:2rem}h2{font-size:1.45rem}p{white-space:pre-wrap}
footer{border-top:1px solid #b9c4cb;padding-top:1rem}footer div{margin:.25rem 0}
@media print{body{padding:0}main{max-width:none;border:1px solid #35586b}}
</style></head><body><main>
<div>${escapeHtml(fields.location)}</div><h1>${escapeHtml(fields.certificate)}</h1><h2>${escapeHtml(fields.recipient)}</h2>
${body ? `<p>${escapeHtml(body)}</p>` : ""}<footer>${details.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</footer>
</main></body></html>`;
}
